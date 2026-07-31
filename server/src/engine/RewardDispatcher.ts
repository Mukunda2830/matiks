import { KeyValueStore } from '../store/KeyValueStore';
import { EventBus } from '../domain/EventBus';
import { RewardTriggeredEvent, LedgerEntry, PlayerState, ActiveMultiplier } from '../domain/models';

export interface DispatchResult {
  status: 'GRANTED' | 'DEDUPED';
  ledgerEntry: LedgerEntry;
  playerState?: PlayerState;
}

export class RewardDispatcher {
  private ledger: LedgerEntry[] = [];
  private playerStates = new Map<string, PlayerState>();

  constructor(
    private store: KeyValueStore,
    private eventBus: EventBus
  ) {
    this.eventBus.on('RewardTriggered', async (event) => {
      await this.dispatch(event);
    });

    // Load persisted ledger from Redis Cloud into memory cache on startup
    this.syncLedgerFromStore().catch(() => {});
  }

  public async syncLedgerFromStore(): Promise<void> {
    try {
      const rawMembers = await this.store.sMembers('ledger:all');
      const entries: LedgerEntry[] = [];
      for (const raw of rawMembers) {
        try {
          entries.push(JSON.parse(raw));
        } catch {}
      }
      entries.sort((a, b) => a.grantedAt - b.grantedAt);
      this.ledger = entries;
    } catch {}
  }

  public async dispatch(event: RewardTriggeredEvent): Promise<DispatchResult> {
    const lockKey = `dedup:${event.idempotencyKey}`;
    const now = Date.now();

    const acquired = await this.store.setIfNotExists(lockKey, '1', 86400);

    if (!acquired) {
      const ledgerEntry: LedgerEntry = {
        id: `led_${now}_${Math.random().toString(36).substring(2, 7)}`,
        playerId: event.playerId,
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        reward: event.reward,
        idempotencyKey: event.idempotencyKey,
        grantedAt: now,
        status: 'DEDUPED',
      };

      // Save to memory cache & Redis Cloud
      this.ledger.push(ledgerEntry);
      await this.store.sAdd('ledger:all', JSON.stringify(ledgerEntry));

      this.eventBus.emit('RewardDeduped', {
        playerId: event.playerId,
        ruleId: event.ruleId,
        idempotencyKey: event.idempotencyKey,
        timestamp: now,
      });

      return { status: 'DEDUPED', ledgerEntry };
    }

    // Grant reward in Redis Cloud & player state
    let state = this.playerStates.get(event.playerId);
    if (!state) {
      state = {
        playerId: event.playerId,
        currentStreak: 0,
        dailyMatchCount: 0,
        dailyWinCount: 0,
        windowedMatches: [],
        activeMultipliers: [],
        inventory: { coins: 0, lootBoxes: 0 },
        lastUpdated: now,
      };
      this.playerStates.set(event.playerId, state);
    }

    const coinsKey = `player:${event.playerId}:coins`;
    const lootBoxesKey = `player:${event.playerId}:loot_boxes`;
    const multsKey = `player:${event.playerId}:multipliers`;

    if (event.reward.type === 'COINS') {
      state.inventory.coins += event.reward.amount;
      await this.store.incrBy(coinsKey, event.reward.amount);
    } else if (event.reward.type === 'LOOT_BOX') {
      state.inventory.lootBoxes += event.reward.amount;
      await this.store.incrBy(lootBoxesKey, event.reward.amount);
    } else if (event.reward.type === 'MULTIPLIER') {
      const durationMs = (event.reward.durationSeconds ?? 1800) * 1000;
      const multItem: ActiveMultiplier = {
        id: `mult_${now}_${Math.random().toString(36).substring(2, 7)}`,
        ruleId: event.ruleId,
        multiplier: event.reward.amount,
        grantedAt: now,
        expiresAt: now + durationMs,
      };
      state.activeMultipliers.push(multItem);
      await this.store.sAdd(multsKey, JSON.stringify(multItem), Math.ceil(durationMs / 1000));
    }
    state.lastUpdated = now;

    const ledgerEntry: LedgerEntry = {
      id: `led_${now}_${Math.random().toString(36).substring(2, 7)}`,
      playerId: event.playerId,
      ruleId: event.ruleId,
      ruleName: event.ruleName,
      reward: event.reward,
      idempotencyKey: event.idempotencyKey,
      grantedAt: now,
      status: 'GRANTED',
    };

    // Save to memory cache & Redis Cloud
    this.ledger.push(ledgerEntry);
    await this.store.sAdd('ledger:all', JSON.stringify(ledgerEntry));

    this.eventBus.emit('RewardGranted', {
      ledgerEntry,
      playerState: state,
    });

    return { status: 'GRANTED', ledgerEntry, playerState: state };
  }

  public getLedger(): LedgerEntry[] {
    return [...this.ledger];
  }

  public async getPlayerState(playerId: string): Promise<PlayerState> {
    let state = this.playerStates.get(playerId);
    const now = Date.now();

    if (!state) {
      state = {
        playerId,
        currentStreak: 0,
        dailyMatchCount: 0,
        dailyWinCount: 0,
        windowedMatches: [],
        activeMultipliers: [],
        inventory: { coins: 0, lootBoxes: 0 },
        lastUpdated: now,
      };
      this.playerStates.set(playerId, state);
    }

    // 1. Sync streak from Redis
    const streakVal = await this.store.get(`player:${playerId}:streak`);
    if (streakVal !== null) {
      state.currentStreak = parseInt(streakVal, 10);
    }

    // 2. Sync daily count from Redis
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyVal = await this.store.get(`player:${playerId}:daily:${todayStr}`);
    if (dailyVal !== null) {
      state.dailyMatchCount = parseInt(dailyVal, 10);
    }

    // 3. Sync coins from Redis
    const coinsVal = await this.store.get(`player:${playerId}:coins`);
    if (coinsVal !== null) {
      state.inventory.coins = parseInt(coinsVal, 10);
    }

    // 4. Sync loot boxes from Redis
    const lootVal = await this.store.get(`player:${playerId}:loot_boxes`);
    if (lootVal !== null) {
      state.inventory.lootBoxes = parseInt(lootVal, 10);
    }

    // 5. Sync active multipliers from Redis
    const multMembers = await this.store.sMembers(`player:${playerId}:multipliers`);
    const activeMultipliers: ActiveMultiplier[] = [];
    for (const raw of multMembers) {
      try {
        const parsed: ActiveMultiplier = JSON.parse(raw);
        if (parsed.expiresAt > now) {
          activeMultipliers.push(parsed);
        }
      } catch {}
    }
    if (activeMultipliers.length > 0) {
      state.activeMultipliers = activeMultipliers;
    } else {
      state.activeMultipliers = state.activeMultipliers.filter((m) => m.expiresAt > now);
    }

    // 6. Sync windowed matches from Redis
    const windowMembers = await this.store.sMembers(`player:${playerId}:window:rule_win_2_algebra_1hr`);
    const cutoff = now - 3600 * 1000;
    const activeWindowMatches: Array<{ matchId: string; category: string; result: 'WIN' | 'LOSS' | 'DRAW'; timestamp: number }> = [];

    for (const m of windowMembers) {
      try {
        if (m.startsWith('{')) {
          const parsed = JSON.parse(m);
          if (parsed.timestamp >= cutoff) {
            activeWindowMatches.push({
              matchId: parsed.matchId || `m_${parsed.timestamp}`,
              category: parsed.category || 'algebra',
              result: parsed.result || 'WIN',
              timestamp: parsed.timestamp,
            });
          }
        }
      } catch {}
    }
    state.windowedMatches = activeWindowMatches;

    return state;
  }

  public clear(): void {
    this.ledger = [];
    this.playerStates.clear();
    this.store.del('ledger:all').catch(() => {});
  }
}
