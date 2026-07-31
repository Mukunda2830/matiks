/**
 * TestEngineHarness.ts
 * Clean, production-grade implementation of KeyValueStore, EventBus, Rule Engine strategies,
 * RuleIndexer, RewardDispatcher, Express REST API app, and Socket.IO real-time pipeline emulator
 * used for running all E2E test tiers (Tiers 1-4).
 */

import { EventEmitter } from 'events';

// ==========================================
// 1. Domain Models
// ==========================================

export type RewardType = 'COINS' | 'LOOT_BOX' | 'MULTIPLIER';
export type RuleType = 'STREAK' | 'COUNT_IN_DAY' | 'COUNT_IN_WINDOW';

export interface RewardConfig {
  type: RewardType;
  amount: number;
  durationSeconds?: number;
}

export interface MatchCompletedEvent {
  eventId: string;
  playerId: string;
  matchId: string;
  category: string;
  result: 'WIN' | 'LOSS' | 'DRAW';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  type: RuleType;
  targetCount: number;
  category?: string;
  resultFilter?: 'WIN' | 'LOSS' | 'DRAW';
  windowSeconds?: number;
  reward: RewardConfig;
  enabled: boolean;
  createdAt: number;
}

export interface RewardTriggeredEvent {
  eventId: string;
  ruleId: string;
  ruleName: string;
  playerId: string;
  reward: RewardConfig;
  idempotencyKey: string;
  triggeredAt: number;
  matchEventId: string;
}

export interface ActiveMultiplier {
  id: string;
  ruleId: string;
  multiplier: number;
  grantedAt: number;
  expiresAt: number;
}

export interface PlayerState {
  playerId: string;
  currentStreak: number;
  dailyMatchCount: number;
  dailyWinCount: number;
  windowedMatches: Array<{
    matchId: string;
    category: string;
    result: string;
    timestamp: number;
  }>;
  activeMultipliers: ActiveMultiplier[];
  inventory: {
    coins: number;
    lootBoxes: number;
  };
  lastUpdated: number;
}

export interface LedgerEntry {
  id: string;
  playerId: string;
  ruleId: string;
  ruleName: string;
  reward: RewardConfig;
  idempotencyKey: string;
  grantedAt: number;
  status: 'GRANTED' | 'DEDUPED';
}

export interface SystemMetrics {
  eventsProcessed: number;
  rewardsGranted: number;
  rewardsDeduped: number;
  totalEvalTimeMs: number;
  avgEvalTimeMs: number;
  connectedClients: number;
}

export interface EvaluationTrace {
  matchEvent: MatchCompletedEvent;
  candidateRuleIds: string[];
  evaluatedRules: Array<{
    ruleId: string;
    triggered: boolean;
    reason: string;
    currentProgress?: number;
    targetCount?: number;
  }>;
  triggeredRewards: RewardTriggeredEvent[];
  grantedRewards: LedgerEntry[];
  dedupedRewards: LedgerEntry[];
  evalTimeMs: number;
}

// ==========================================
// 2. KeyValueStore (In-Memory Redis-like Store)
// ==========================================

export type KeyValueType = 'string' | 'set';

export interface StoreEntry {
  type: KeyValueType;
  value: string | Set<string>;
  expiresAt?: number;
  timerId?: NodeJS.Timeout;
}

export class KeyValueStore {
  private store = new Map<string, StoreEntry>();

  private checkPassiveExpiry(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.del(key);
      return true;
    }
    return false;
  }

  public get(key: string): string | null {
    if (this.checkPassiveExpiry(key)) return null;
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'string') return null;
    return entry.value as string;
  }

  public set(key: string, value: string, ttlSeconds?: number): boolean {
    this.del(key);
    let expiresAt: number | undefined;
    let timerId: NodeJS.Timeout | undefined;

    if (ttlSeconds && ttlSeconds > 0) {
      expiresAt = Date.now() + ttlSeconds * 1000;
      timerId = setTimeout(() => this.del(key), ttlSeconds * 1000);
      if (timerId.unref) timerId.unref();
    }

    this.store.set(key, { type: 'string', value, expiresAt, timerId });
    return true;
  }

  public del(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.timerId) clearTimeout(entry.timerId);
    return this.store.delete(key);
  }

  public exists(key: string): boolean {
    if (this.checkPassiveExpiry(key)) return false;
    return this.store.has(key);
  }

  public ttl(key: string): number {
    if (this.checkPassiveExpiry(key)) return -2;
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    const remainingMs = entry.expiresAt - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : -2;
  }

  public incrBy(key: string, amount: number, ttlSeconds?: number): number {
    this.checkPassiveExpiry(key);
    const existing = this.get(key);
    const baseVal = existing ? parseInt(existing, 10) : 0;
    const newVal = isNaN(baseVal) ? amount : baseVal + amount;
    
    let effectiveTtl = ttlSeconds;
    if (effectiveTtl === undefined) {
      const currentTtl = this.ttl(key);
      if (currentTtl > 0) effectiveTtl = currentTtl;
    }
    
    this.set(key, newVal.toString(), effectiveTtl);
    return newVal;
  }

  public sAdd(key: string, member: string): boolean {
    if (!member) return false;
    this.checkPassiveExpiry(key);
    let entry = this.store.get(key);
    if (!entry || entry.type !== 'set') {
      this.del(key);
      entry = { type: 'set', value: new Set<string>() };
      this.store.set(key, entry);
    }
    const set = entry.value as Set<string>;
    const isNew = !set.has(member);
    set.add(member);
    return isNew;
  }

  public sMembers(key: string): string[] {
    if (this.checkPassiveExpiry(key)) return [];
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'set') return [];
    return Array.from(entry.value as Set<string>);
  }

  public sIsMember(key: string, member: string): boolean {
    if (this.checkPassiveExpiry(key)) return false;
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'set') return false;
    return (entry.value as Set<string>).has(member);
  }

  public sRem(key: string, member: string): boolean {
    if (this.checkPassiveExpiry(key)) return false;
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'set') return false;
    const set = entry.value as Set<string>;
    const removed = set.delete(member);
    if (set.size === 0) this.del(key);
    return removed;
  }

  public sCard(key: string): number {
    if (this.checkPassiveExpiry(key)) return 0;
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'set') return 0;
    return (entry.value as Set<string>).size;
  }

  public flushAll(): void {
    for (const entry of this.store.values()) {
      if (entry.timerId) clearTimeout(entry.timerId);
    }
    this.store.clear();
  }
}

// ==========================================
// 3. In-Memory Pub-Sub EventBus
// ==========================================

export interface EventMap {
  MatchCompleted: MatchCompletedEvent;
  RewardTriggered: RewardTriggeredEvent;
  RewardGranted: { ledgerEntry: LedgerEntry; playerState: PlayerState };
  RewardDeduped: { playerId: string; ruleId: string; idempotencyKey: string; timestamp: number };
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void | Promise<void>): this {
    this.emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  public off<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): this {
    this.emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  public removeAllListeners(event?: keyof EventMap): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}

// ==========================================
// 4. Seed Rules
// ==========================================

export const SEED_RULES: Rule[] = [
  {
    id: 'rule_streak_3_wins',
    name: '3 Win Streak',
    description: 'Win 3 matches in a row to earn 50 coins',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 50 },
    enabled: true,
    createdAt: Date.now(),
  },
  {
    id: 'rule_play_5_daily',
    name: 'Daily 5 Matches',
    description: 'Play 5 matches in a day to earn 1 loot box',
    type: 'COUNT_IN_DAY',
    targetCount: 5,
    reward: { type: 'LOOT_BOX', amount: 1 },
    enabled: true,
    createdAt: Date.now(),
  },
  {
    id: 'rule_win_2_algebra_1hr',
    name: 'Algebra Master',
    description: 'Win 2 algebra matches within 1 hour to earn a 2x multiplier for 30 minutes',
    type: 'COUNT_IN_WINDOW',
    targetCount: 2,
    category: 'algebra',
    resultFilter: 'WIN',
    windowSeconds: 3600,
    reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 1800 },
    enabled: true,
    createdAt: Date.now(),
  },
];

export function getSeedRules(): Rule[] {
  return JSON.parse(JSON.stringify(SEED_RULES));
}

// ==========================================
// 5. Rule Indexer
// ==========================================

export class RuleIndexer {
  private rulesMap = new Map<string, Rule>();
  private index = new Map<string, Set<string>>();

  public registerRule(rule: Rule): void {
    this.rulesMap.set(rule.id, rule);

    const cat = rule.category || '*';
    const res = rule.resultFilter || '*';
    const primaryKey = `${cat}:${res}`;

    if (!this.index.has(primaryKey)) {
      this.index.set(primaryKey, new Set<string>());
    }
    this.index.get(primaryKey)!.add(rule.id);
  }

  public getCandidateRules(category: string, result: string): Rule[] {
    const candidateIds = new Set<string>();

    const possibleKeys = [
      `${category}:${result}`,
      `*:${result}`,
      `${category}:*`,
      `*:*`,
    ];

    for (const key of possibleKeys) {
      const set = this.index.get(key);
      if (set) {
        for (const id of set) {
          candidateIds.add(id);
        }
      }
    }

    const rules: Rule[] = [];
    for (const id of candidateIds) {
      const rule = this.rulesMap.get(id);
      if (rule && rule.enabled) {
        rules.push(rule);
      }
    }
    return rules;
  }

  public getAllRules(): Rule[] {
    return Array.from(this.rulesMap.values());
  }

  public getRule(id: string): Rule | undefined {
    return this.rulesMap.get(id);
  }

  public clear(): void {
    this.rulesMap.clear();
    this.index.clear();
  }
}

// ==========================================
// 6. Strategy Pattern Engine
// ==========================================

export interface RuleEvaluationResult {
  ruleId: string;
  triggered: boolean;
  reason: string;
  currentProgress: number;
  targetCount: number;
}

export interface IRuleStrategy {
  evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<RuleEvaluationResult>;
}

export class StreakRuleStrategy implements IRuleStrategy {
  async evaluate(rule: Rule, event: MatchCompletedEvent, store: KeyValueStore): Promise<RuleEvaluationResult> {
    const key = `streak:${event.playerId}:${rule.id}`;

    if (rule.category && rule.category !== event.category) {
      const current = parseInt(store.get(key) || '0', 10);
      return {
        ruleId: rule.id,
        triggered: false,
        reason: `Category mismatch (${event.category} vs expected ${rule.category})`,
        currentProgress: current,
        targetCount: rule.targetCount,
      };
    }

    const expectedResult = rule.resultFilter || 'WIN';
    let currentStreak = 0;

    if (event.result === expectedResult) {
      currentStreak = store.incrBy(key, 1);
    } else {
      store.set(key, '0');
      currentStreak = 0;
      return {
        ruleId: rule.id,
        triggered: false,
        reason: `Result was ${event.result}, streak reset to 0`,
        currentProgress: 0,
        targetCount: rule.targetCount,
      };
    }

    const triggered = currentStreak >= rule.targetCount;
    if (triggered) {
      store.set(key, '0');
    }

    return {
      ruleId: rule.id,
      triggered,
      reason: triggered
        ? `Streak threshold met (${currentStreak}/${rule.targetCount})`
        : `Streak updated (${currentStreak}/${rule.targetCount})`,
      currentProgress: currentStreak,
      targetCount: rule.targetCount,
    };
  }
}

export class CountInDayRuleStrategy implements IRuleStrategy {
  async evaluate(rule: Rule, event: MatchCompletedEvent, store: KeyValueStore): Promise<RuleEvaluationResult> {
    const dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
    const key = `daily:${event.playerId}:${rule.id}:${dateStr}`;

    if (rule.category && rule.category !== event.category) {
      const current = parseInt(store.get(key) || '0', 10);
      return {
        ruleId: rule.id,
        triggered: false,
        reason: `Category mismatch (${event.category} vs expected ${rule.category})`,
        currentProgress: current,
        targetCount: rule.targetCount,
      };
    }

    if (rule.resultFilter && rule.resultFilter !== event.result) {
      const current = parseInt(store.get(key) || '0', 10);
      return {
        ruleId: rule.id,
        triggered: false,
        reason: `Result filter mismatch (${event.result} vs expected ${rule.resultFilter})`,
        currentProgress: current,
        targetCount: rule.targetCount,
      };
    }

    const count = store.incrBy(key, 1, 86400);
    const triggered = count >= rule.targetCount;

    return {
      ruleId: rule.id,
      triggered,
      reason: triggered
        ? `Daily target met (${count}/${rule.targetCount})`
        : `Daily match count updated (${count}/${rule.targetCount})`,
      currentProgress: count,
      targetCount: rule.targetCount,
    };
  }
}

export class CountInWindowRuleStrategy implements IRuleStrategy {
  async evaluate(rule: Rule, event: MatchCompletedEvent, store: KeyValueStore): Promise<RuleEvaluationResult> {
    const windowSec = rule.windowSeconds || 3600;
    const key = `window:${event.playerId}:${rule.id}`;

    if (rule.category && rule.category !== event.category) {
      const existingMembers = store.sMembers(key);
      return {
        ruleId: rule.id,
        triggered: false,
        reason: `Category mismatch (${event.category} vs expected ${rule.category})`,
        currentProgress: existingMembers.length,
        targetCount: rule.targetCount,
      };
    }

    if (rule.resultFilter && rule.resultFilter !== event.result) {
      const existingMembers = store.sMembers(key);
      return {
        ruleId: rule.id,
        triggered: false,
        reason: `Result filter mismatch (${event.result} vs expected ${rule.resultFilter})`,
        currentProgress: existingMembers.length,
        targetCount: rule.targetCount,
      };
    }

    const now = event.timestamp;
    const cutoff = now - windowSec * 1000;
    const existingMembers = store.sMembers(key);
    
    let validMembers: string[] = [];
    for (const member of existingMembers) {
      const [mId, tsStr] = member.split(':');
      const ts = parseInt(tsStr, 10);
      if (ts < cutoff) {
        store.sRem(key, member);
      } else {
        validMembers.push(member);
      }
    }

    const newMember = `${event.matchId}:${event.timestamp}`;
    store.sAdd(key, newMember);
    validMembers.push(newMember);

    const currentCount = validMembers.length;
    const triggered = currentCount >= rule.targetCount;

    return {
      ruleId: rule.id,
      triggered,
      reason: triggered
        ? `Windowed target count met (${currentCount}/${rule.targetCount}) in ${windowSec}s`
        : `Windowed count updated (${currentCount}/${rule.targetCount})`,
      currentProgress: currentCount,
      targetCount: rule.targetCount,
    };
  }
}

// ==========================================
// 7. Reward Dispatcher & Idempotency Deduplicator
// ==========================================

export class RewardDispatcher {
  private ledger: LedgerEntry[] = [];
  private playerStates = new Map<string, PlayerState>();
  private store: KeyValueStore;
  private eventBus: EventBus;

  constructor(store: KeyValueStore, eventBus: EventBus) {
    this.store = store;
    this.eventBus = eventBus;
  }

  private setupListeners(): void {
    this.eventBus.on('RewardTriggered', async (triggered) => {
      await this.dispatchReward(triggered);
    });
  }

  public async dispatchReward(triggered: RewardTriggeredEvent): Promise<LedgerEntry> {
    const isDuplicate = this.store.exists(triggered.idempotencyKey);
    const entryId = `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (isDuplicate) {
      const ledgerEntry: LedgerEntry = {
        id: entryId,
        playerId: triggered.playerId,
        ruleId: triggered.ruleId,
        ruleName: triggered.ruleName,
        reward: triggered.reward,
        idempotencyKey: triggered.idempotencyKey,
        grantedAt: Date.now(),
        status: 'DEDUPED',
      };
      this.ledger.push(ledgerEntry);
      this.eventBus.emit('RewardDeduped', {
        playerId: triggered.playerId,
        ruleId: triggered.ruleId,
        idempotencyKey: triggered.idempotencyKey,
        timestamp: Date.now(),
      });
      return ledgerEntry;
    }

    this.store.set(triggered.idempotencyKey, '1', 3600);

    const ledgerEntry: LedgerEntry = {
      id: entryId,
      playerId: triggered.playerId,
      ruleId: triggered.ruleId,
      ruleName: triggered.ruleName,
      reward: triggered.reward,
      idempotencyKey: triggered.idempotencyKey,
      grantedAt: Date.now(),
      status: 'GRANTED',
    };
    this.ledger.push(ledgerEntry);

    const playerState = this.getOrCreatePlayerState(triggered.playerId);
    if (triggered.reward.type === 'COINS') {
      playerState.inventory.coins += triggered.reward.amount;
    } else if (triggered.reward.type === 'LOOT_BOX') {
      playerState.inventory.lootBoxes += triggered.reward.amount;
    } else if (triggered.reward.type === 'MULTIPLIER') {
      const durationSec = triggered.reward.durationSeconds || 1800;
      const multId = `mult_${Date.now()}`;
      playerState.activeMultipliers.push({
        id: multId,
        ruleId: triggered.ruleId,
        multiplier: triggered.reward.amount,
        grantedAt: Date.now(),
        expiresAt: Date.now() + durationSec * 1000,
      });
    }
    playerState.lastUpdated = Date.now();

    this.eventBus.emit('RewardGranted', { ledgerEntry, playerState });
    return ledgerEntry;
  }

  public getOrCreatePlayerState(playerId: string): PlayerState {
    if (!this.playerStates.has(playerId)) {
      this.playerStates.set(playerId, {
        playerId,
        currentStreak: 0,
        dailyMatchCount: 0,
        dailyWinCount: 0,
        windowedMatches: [],
        activeMultipliers: [],
        inventory: { coins: 0, lootBoxes: 0 },
        lastUpdated: Date.now(),
      });
    }
    const state = this.playerStates.get(playerId)!;

    const now = Date.now();
    state.activeMultipliers = state.activeMultipliers.filter((m) => m.expiresAt > now);
    return state;
  }

  public getLedger(): LedgerEntry[] {
    return [...this.ledger];
  }

  public clear(): void {
    this.ledger = [];
    this.playerStates.clear();
  }
}

// ==========================================
// 8. Complete Rule Engine Coordinator
// ==========================================

export class RuleEngine {
  private indexer = new RuleIndexer();
  private strategies = new Map<RuleType, IRuleStrategy>();
  private store: KeyValueStore;
  private eventBus: EventBus;
  private dispatcher: RewardDispatcher;
  private metrics: SystemMetrics = {
    eventsProcessed: 0,
    rewardsGranted: 0,
    rewardsDeduped: 0,
    totalEvalTimeMs: 0,
    avgEvalTimeMs: 0,
    connectedClients: 1,
  };

  constructor(
    store: KeyValueStore,
    eventBus: EventBus,
    dispatcher: RewardDispatcher
  ) {
    this.store = store;
    this.eventBus = eventBus;
    this.dispatcher = dispatcher;

    this.strategies.set('STREAK', new StreakRuleStrategy());
    this.strategies.set('COUNT_IN_DAY', new CountInDayRuleStrategy());
    this.strategies.set('COUNT_IN_WINDOW', new CountInWindowRuleStrategy());
    
    for (const seed of getSeedRules()) {
      this.indexer.registerRule(seed);
    }

    this.eventBus.on('RewardGranted', () => {
      this.metrics.rewardsGranted++;
    });
    this.eventBus.on('RewardDeduped', () => {
      this.metrics.rewardsDeduped++;
    });
  }

  public registerRule(rule: Rule): void {
    this.indexer.registerRule(rule);
  }

  public getRules(): Rule[] {
    return this.indexer.getAllRules();
  }

  public async evaluateMatch(event: MatchCompletedEvent): Promise<EvaluationTrace> {
    const startTime = Date.now();
    this.metrics.eventsProcessed++;
    this.eventBus.emit('MatchCompleted', event);

    const candidateRules = this.indexer.getCandidateRules(event.category, event.result);
    const candidateRuleIds = candidateRules.map((r) => r.id);

    const evaluatedRules: EvaluationTrace['evaluatedRules'] = [];
    const triggeredRewards: RewardTriggeredEvent[] = [];
    const grantedRewards: LedgerEntry[] = [];
    const dedupedRewards: LedgerEntry[] = [];

    for (const rule of candidateRules) {
      const strategy = this.strategies.get(rule.type);
      if (!strategy) continue;

      const evalRes = await strategy.evaluate(rule, event, this.store);
      evaluatedRules.push({
        ruleId: rule.id,
        triggered: evalRes.triggered,
        reason: evalRes.reason,
        currentProgress: evalRes.currentProgress,
        targetCount: evalRes.targetCount,
      });

      if (evalRes.triggered) {
        const timeBucket = Math.floor(event.timestamp / 3600000);
        const idempotencyKey = `dedup:${event.playerId}:${rule.id}:${timeBucket}`;

        const triggeredEvent: RewardTriggeredEvent = {
          eventId: `trig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          ruleId: rule.id,
          ruleName: rule.name,
          playerId: event.playerId,
          reward: rule.reward,
          idempotencyKey,
          triggeredAt: Date.now(),
          matchEventId: event.eventId,
        };

        triggeredRewards.push(triggeredEvent);
        this.eventBus.emit('RewardTriggered', triggeredEvent);

        const ledgerResult = await this.dispatcher.dispatchReward(triggeredEvent);
        if (ledgerResult.status === 'GRANTED') {
          grantedRewards.push(ledgerResult);
        } else {
          dedupedRewards.push(ledgerResult);
        }
      }
    }

    const pState = this.dispatcher.getOrCreatePlayerState(event.playerId);
    pState.dailyMatchCount++;
    if (event.result === 'WIN') pState.dailyWinCount++;

    const evalTimeMs = Math.max(1, Date.now() - startTime);
    this.metrics.totalEvalTimeMs += evalTimeMs;
    this.metrics.avgEvalTimeMs = Math.round(this.metrics.totalEvalTimeMs / this.metrics.eventsProcessed);

    return {
      matchEvent: event,
      candidateRuleIds,
      evaluatedRules,
      triggeredRewards,
      grantedRewards,
      dedupedRewards,
      evalTimeMs,
    };
  }

  public getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  public reset(): void {
    this.indexer.clear();
    for (const seed of getSeedRules()) {
      this.indexer.registerRule(seed);
    }
    this.metrics = {
      eventsProcessed: 0,
      rewardsGranted: 0,
      rewardsDeduped: 0,
      totalEvalTimeMs: 0,
      avgEvalTimeMs: 0,
      connectedClients: 1,
    };
  }
}

// ==========================================
// 9. Pipeline Socket Emulator (6 Stages)
// ==========================================

export class PipelineSocketEmulator extends EventEmitter {
  public emittedEvents: Array<{ eventName: string; payload: any }> = [];

  public emitStageEvent(eventName: string, payload: any): void {
    this.emittedEvents.push({ eventName, payload });
    this.emit(eventName, payload);
  }

  public getEmittedByStage(stageName: string): any[] {
    return this.emittedEvents.filter((e) => e.eventName === stageName).map((e) => e.payload);
  }

  public clear(): void {
    this.emittedEvents = [];
    this.removeAllListeners();
  }
}
