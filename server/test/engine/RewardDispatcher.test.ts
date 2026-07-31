import { describe, it, expect, beforeEach } from 'vitest';
import { KeyValueStore } from '../../src/store/KeyValueStore';
import { EventBus } from '../../src/domain/EventBus';
import { RewardDispatcher } from '../../src/engine/RewardDispatcher';
import { RewardTriggeredEvent, LedgerEntry, PlayerState } from '../../src/domain/models';

describe('RewardDispatcher Test Suite', () => {
  let store: KeyValueStore;
  let eventBus: EventBus;
  let dispatcher: RewardDispatcher;

  beforeEach(async () => {
    store = new KeyValueStore();
    await store.flushAll();
    eventBus = new EventBus();
    dispatcher = new RewardDispatcher(store, eventBus);
  });

  const coinTriggerEvent: RewardTriggeredEvent = {
    eventId: 'rte_1',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: 'player1',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'player1:rule_streak_3_wins:cycle:1:step:1',
    triggeredAt: Date.now(),
    matchEventId: 'evt_1',
  };

  const lootBoxTriggerEvent: RewardTriggeredEvent = {
    eventId: 'rte_2',
    ruleId: 'rule_play_5_daily',
    ruleName: 'Daily 5 Matches',
    playerId: 'player1',
    reward: { type: 'LOOT_BOX', amount: 1 },
    idempotencyKey: 'player1:rule_play_5_daily:2026-07-31',
    triggeredAt: Date.now(),
    matchEventId: 'evt_2',
  };

  const multiplierTriggerEvent: RewardTriggeredEvent = {
    eventId: 'rte_3',
    ruleId: 'rule_win_2_algebra_1hr',
    ruleName: 'Algebra Master',
    playerId: 'player1',
    reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 1800 },
    idempotencyKey: 'player1:rule_win_2_algebra_1hr:time_bucket_123',
    triggeredAt: Date.now(),
    matchEventId: 'evt_3',
  };

  it('grants reward on initial trigger, sets deduplication lock with TTL, and emits RewardGranted', async () => {
    let grantedPayload: { ledgerEntry: LedgerEntry; playerState: PlayerState } | null = null;
    eventBus.on('RewardGranted', (payload) => {
      grantedPayload = payload;
    });

    const res = await dispatcher.dispatch(coinTriggerEvent);

    expect(res.status).toBe('GRANTED');
    expect(res.ledgerEntry.status).toBe('GRANTED');
    expect(res.ledgerEntry.idempotencyKey).toBe('player1:rule_streak_3_wins:cycle:1:step:1');
    expect(res.playerState?.inventory.coins).toBe(50);

    expect(grantedPayload).not.toBeNull();
    expect(grantedPayload!.ledgerEntry.id).toBe(res.ledgerEntry.id);

    // Verify deduplication lock exists in store with 24h TTL
    const lockExists = await store.exists('dedup:player1:rule_streak_3_wins:cycle:1:step:1');
    expect(lockExists).toBe(true);
    const ttl = await store.ttl('dedup:player1:rule_streak_3_wins:cycle:1:step:1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400);
  });

  it('deduplicates reward on identical trigger key, produces DEDUPED ledger entry, and emits RewardDeduped', async () => {
    let dedupedPayload: any = null;
    eventBus.on('RewardDeduped', (payload) => {
      dedupedPayload = payload;
    });

    // 1st dispatch -> GRANTED
    const res1 = await dispatcher.dispatch(coinTriggerEvent);
    expect(res1.status).toBe('GRANTED');

    // 2nd dispatch with same idempotency key -> DEDUPED
    const res2 = await dispatcher.dispatch(coinTriggerEvent);
    expect(res2.status).toBe('DEDUPED');
    expect(res2.ledgerEntry.status).toBe('DEDUPED');

    expect(dedupedPayload).not.toBeNull();
    expect(dedupedPayload.idempotencyKey).toBe(coinTriggerEvent.idempotencyKey);

    // Player inventory must remain 50 (not 100)
    const state = await dispatcher.getPlayerState('player1');
    expect(state.inventory.coins).toBe(50);

    // Ledger must contain 2 entries (1 GRANTED, 1 DEDUPED)
    const ledger = dispatcher.getLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[0].status).toBe('GRANTED');
    expect(ledger[1].status).toBe('DEDUPED');
  });

  it('updates player inventory for LOOT_BOX and MULTIPLIER rewards correctly', async () => {
    await dispatcher.dispatch(lootBoxTriggerEvent);
    await dispatcher.dispatch(multiplierTriggerEvent);

    const state = await dispatcher.getPlayerState('player1');
    expect(state.inventory.lootBoxes).toBe(1);
    expect(state.activeMultipliers).toHaveLength(1);
    expect(state.activeMultipliers[0].multiplier).toBe(2);
    expect(state.activeMultipliers[0].expiresAt).toBeGreaterThan(Date.now());
  });

  it('aggregates live player state combining KeyValueStore counters and active multipliers', async () => {
    // Manually set store counters
    await store.set('player:player1:streak', '4');
    const todayStr = new Date().toISOString().split('T')[0];
    await store.set(`player:player1:daily:${todayStr}`, '5');

    const state = await dispatcher.getPlayerState('player1');
    expect(state.currentStreak).toBe(4);
    expect(state.dailyMatchCount).toBe(5);
  });
});
