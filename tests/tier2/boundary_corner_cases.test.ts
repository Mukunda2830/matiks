import test from 'node:test';
import assert from 'node:assert';
import {
  KeyValueStore,
  EventBus,
  RewardDispatcher,
  RuleEngine,
  StreakRuleStrategy,
  CountInDayRuleStrategy,
  CountInWindowRuleStrategy,
  RuleIndexer,
} from '../harness/TestEngineHarness.ts';
import type { Rule } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent, createMockRule } from '../harness/mockData.ts';

// 1. Streak Resets on LOSS
test('Tier 2 Boundary: Streak Resets to 0 Immediately on LOSS', async () => {
  const store = new KeyValueStore();
  const strategy = new StreakRuleStrategy();
  const rule: Rule = createMockRule({ type: 'STREAK', targetCount: 3, resultFilter: 'WIN' });

  const pId = 'p_b1';
  // Win 1, Win 2
  await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'WIN' }), store);
  const res2 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'WIN' }), store);
  assert.strictEqual(res2.currentProgress, 2);

  // LOSS -> reset
  const resLoss = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'LOSS' }), store);
  assert.strictEqual(resLoss.currentProgress, 0);
  assert.strictEqual(resLoss.triggered, false);

  // Subsequent WIN starts streak at 1
  const res3 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'WIN' }), store);
  assert.strictEqual(res3.currentProgress, 1);
});

// 2. Streak Category Filter Boundary
test('Tier 2 Boundary: Streak Does Not Increment on Mismatched Category', async () => {
  const store = new KeyValueStore();
  const strategy = new StreakRuleStrategy();
  const rule: Rule = createMockRule({ type: 'STREAK', targetCount: 2, category: 'algebra', resultFilter: 'WIN' });

  const pId = 'p_b2';
  const resDiff = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, category: 'history', result: 'WIN' }), store);
  assert.strictEqual(resDiff.currentProgress, 0);
  assert.strictEqual(resDiff.triggered, false);
});

// 3. Daily Count Result Filter Boundary
test('Tier 2 Boundary: Daily Count Ignores Mismatched Result Filter', async () => {
  const store = new KeyValueStore();
  const strategy = new CountInDayRuleStrategy();
  const rule: Rule = createMockRule({ type: 'COUNT_IN_DAY', targetCount: 5, resultFilter: 'WIN' });

  const pId = 'p_b3';
  const resLoss = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'LOSS' }), store);
  assert.strictEqual(resLoss.currentProgress, 0);
});

// 4. TTL Expiration During Streak Accumulation
test('Tier 2 Boundary: TTL Expiration Clears Key During Inactive Reading', async () => {
  const store = new KeyValueStore();
  store.set('streak:p_ttl:r1', '2', 1); // 1s TTL

  assert.strictEqual(store.get('streak:p_ttl:r1'), '2');
  await new Promise((r) => setTimeout(r, 1100));

  // Passive expiration returns null
  assert.strictEqual(store.get('streak:p_ttl:r1'), null);
  assert.strictEqual(store.exists('streak:p_ttl:r1'), false);
});

// 5. Daily Count Midnight Rollover Boundary
test('Tier 2 Boundary: Daily Count Separated Across UTC Midnight Dates', async () => {
  const store = new KeyValueStore();
  const strategy = new CountInDayRuleStrategy();
  const rule: Rule = createMockRule({ type: 'COUNT_IN_DAY', targetCount: 2 });

  const pId = 'p_b5';
  const day1Ts = new Date('2026-07-30T23:59:00Z').getTime();
  const day2Ts = new Date('2026-07-31T00:01:00Z').getTime();

  const resDay1 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, timestamp: day1Ts }), store);
  assert.strictEqual(resDay1.currentProgress, 1);

  // New day starts fresh counter at 1
  const resDay2 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, timestamp: day2Ts }), store);
  assert.strictEqual(resDay2.currentProgress, 1);
});

// 6. Windowed Expiration Boundary at Exact Cutoff
test('Tier 2 Boundary: Windowed Matches Expire Exactly outside windowSeconds Boundary', async () => {
  const store = new KeyValueStore();
  const strategy = new CountInWindowRuleStrategy();
  const rule: Rule = createMockRule({ type: 'COUNT_IN_WINDOW', targetCount: 2, windowSeconds: 60 }); // 60s window

  const pId = 'p_b6';
  const now = 100000;
  const match1Ts = now - 61 * 1000; // 61s ago (outside 60s window)

  await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, matchId: 'm1', timestamp: match1Ts }), store);
  const res2 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, matchId: 'm2', timestamp: now }), store);

  // match1 expired out of window, count is 1
  assert.strictEqual(res2.currentProgress, 1);
  assert.strictEqual(res2.triggered, false);
});

// 7. Wildcard Rule Indexing Fallback
test('Tier 2 Boundary: Rule Indexer Handles Omitted Category & Result (Universal Wildcard)', () => {
  const indexer = new RuleIndexer();
  const universalRule = createMockRule({ id: 'r_univ', category: undefined, resultFilter: undefined });
  indexer.registerRule(universalRule);

  const candidates = indexer.getCandidateRules('quantum_physics', 'DRAW');
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'r_univ');
});

// 8. Idempotency Collision Within Same Bucket
test('Tier 2 Boundary: Idempotency Key Lock Rejects Replayed Triggers in Same Hour Bucket', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const key = 'dedup:p_b8:rule_b8:100';
  const trigger = {
    eventId: 'trig_b8',
    ruleId: 'rule_b8',
    ruleName: 'B8 Rule',
    playerId: 'p_b8',
    reward: { type: 'COINS' as const, amount: 50 },
    idempotencyKey: key,
    triggeredAt: Date.now(),
    matchEventId: 'm_b8',
  };

  const res1 = await dispatcher.dispatchReward(trigger);
  const res2 = await dispatcher.dispatchReward(trigger);

  assert.strictEqual(res1.status, 'GRANTED');
  assert.strictEqual(res2.status, 'DEDUPED');
});

// 9. Independent Player Idempotency Locks
test('Tier 2 Boundary: Distinct Players Sharing Rule ID do not collide on Idempotency Keys', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const tPlayerA = {
    eventId: 't_a',
    ruleId: 'rule_shared',
    ruleName: 'Shared Rule',
    playerId: 'player_A',
    reward: { type: 'COINS' as const, amount: 50 },
    idempotencyKey: 'dedup:player_A:rule_shared:10',
    triggeredAt: Date.now(),
    matchEventId: 'm_a',
  };

  const tPlayerB = {
    eventId: 't_b',
    ruleId: 'rule_shared',
    ruleName: 'Shared Rule',
    playerId: 'player_B',
    reward: { type: 'COINS' as const, amount: 50 },
    idempotencyKey: 'dedup:player_B:rule_shared:10',
    triggeredAt: Date.now(),
    matchEventId: 'm_b',
  };

  const resA = await dispatcher.dispatchReward(tPlayerA);
  const resB = await dispatcher.dispatchReward(tPlayerB);

  assert.strictEqual(resA.status, 'GRANTED');
  assert.strictEqual(resB.status, 'GRANTED');
});

// 10. KeyValueStore Atomic IncrBy Handles Missing Keys Defaults to 0
test('Tier 2 Boundary: KeyValueStore incrBy Defaults Missing Base Value to 0', () => {
  const store = new KeyValueStore();
  const val = store.incrBy('missing_counter', 10);
  assert.strictEqual(val, 10);
  assert.strictEqual(store.get('missing_counter'), '10');
});

// 11. KeyValueStore Negative Increments
test('Tier 2 Boundary: KeyValueStore incrBy Handles Negative Values', () => {
  const store = new KeyValueStore();
  store.set('neg_counter', '20');
  const val = store.incrBy('neg_counter', -15);
  assert.strictEqual(val, 5);
  assert.strictEqual(store.get('neg_counter'), '5');
});

// 12. KeyValueStore Type Conflict Handling (sAdd on String key)
test('Tier 2 Boundary: KeyValueStore Overwrites String Entry when sAdd is invoked', () => {
  const store = new KeyValueStore();
  store.set('type_conflict', 'string_data');
  assert.strictEqual(store.get('type_conflict'), 'string_data');

  store.sAdd('type_conflict', 'member_1');
  assert.strictEqual(store.get('type_conflict'), null);
  assert.strictEqual(store.sIsMember('type_conflict', 'member_1'), true);
});

// 13. KeyValueStore Type Conflict Handling (get on Set key)
test('Tier 2 Boundary: KeyValueStore get Returns null when invoked on Set Key', () => {
  const store = new KeyValueStore();
  store.sAdd('set_key', 'm1');
  assert.strictEqual(store.get('set_key'), null);
  assert.strictEqual(store.exists('set_key'), true);
});

// 14. KeyValueStore sRem Non-Existent Member
test('Tier 2 Boundary: sRem on Non-Existent Member Returns false', () => {
  const store = new KeyValueStore();
  store.sAdd('set_key2', 'm1');
  assert.strictEqual(store.sRem('set_key2', 'non_existent_m'), false);
  assert.strictEqual(store.sRem('non_existent_key', 'm1'), false);
});

// 15. KeyValueStore del Non-Existent Key
test('Tier 2 Boundary: del on Non-Existent Key Returns false', () => {
  const store = new KeyValueStore();
  assert.strictEqual(store.del('no_such_key'), false);
});

// 16. KeyValueStore ttl for Non-Existent vs Persistent Key
test('Tier 2 Boundary: KeyValueStore ttl Return Values (-2 for missing, -1 for persistent)', () => {
  const store = new KeyValueStore();
  assert.strictEqual(store.ttl('ghost_key'), -2);

  store.set('perm_key', 'value');
  assert.strictEqual(store.ttl('perm_key'), -1);
});

// 17. Active Multiplier Stacking for Same Player
test('Tier 2 Boundary: Player State Supports Stacking Multiple Active Multipliers', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const pId = 'p_b17';
  await dispatcher.dispatchReward({
    eventId: 't1',
    ruleId: 'r_mult1',
    ruleName: '2x Mult',
    playerId: pId,
    reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 300 },
    idempotencyKey: 'dedup:p_b17:r_mult1:1',
    triggeredAt: Date.now(),
    matchEventId: 'm1',
  });

  await dispatcher.dispatchReward({
    eventId: 't2',
    ruleId: 'r_mult2',
    ruleName: '3x Mult',
    playerId: pId,
    reward: { type: 'MULTIPLIER', amount: 3, durationSeconds: 600 },
    idempotencyKey: 'dedup:p_b17:r_mult2:1',
    triggeredAt: Date.now(),
    matchEventId: 'm2',
  });

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.activeMultipliers.length, 2);
  assert.strictEqual(state.activeMultipliers[0].multiplier, 2);
  assert.strictEqual(state.activeMultipliers[1].multiplier, 3);
});

// 18. Large Target Count Streak Evaluation
test('Tier 2 Boundary: Streak Engine Handles Large Target Count (Target 100)', async () => {
  const store = new KeyValueStore();
  const strategy = new StreakRuleStrategy();
  const rule: Rule = createMockRule({ type: 'STREAK', targetCount: 100 });

  const pId = 'p_b18';
  store.set(`streak:${pId}:${rule.id}`, '98');

  const res99 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'WIN' }), store);
  assert.strictEqual(res99.currentProgress, 99);
  assert.strictEqual(res99.triggered, false);

  const res100 = await strategy.evaluate(rule, createMockMatchEvent({ playerId: pId, result: 'WIN' }), store);
  assert.strictEqual(res100.currentProgress, 100);
  assert.strictEqual(res100.triggered, true);
});

// 19. Dynamically Re-Enabling Rule
test('Tier 2 Boundary: Dynamically Enabling a Disabled Rule Instantly Restores Evaluation', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const toggleRule: Rule = createMockRule({ id: 'r_toggle', type: 'STREAK', targetCount: 1, enabled: false });
  engine.registerRule(toggleRule);

  // While disabled: candidate not found
  const trace1 = await engine.evaluateMatch(createMockMatchEvent({ result: 'WIN' }));
  assert.strictEqual(trace1.candidateRuleIds.includes('r_toggle'), false);

  // Enable rule
  toggleRule.enabled = true;
  engine.registerRule(toggleRule);

  // Now enabled: candidate found and triggered
  const trace2 = await engine.evaluateMatch(createMockMatchEvent({ result: 'WIN' }));
  assert.strictEqual(trace2.candidateRuleIds.includes('r_toggle'), true);
});

// 20. EventBus Listener Double Registration Prevention Safety
test('Tier 2 Boundary: EventBus Manages Subscriptions and Emission Reliably', () => {
  const bus = new EventBus();
  let callCount = 0;
  const handler = () => { callCount++; };

  bus.on('MatchCompleted', handler);
  bus.emit('MatchCompleted', createMockMatchEvent());
  assert.strictEqual(callCount, 1);

  bus.removeAllListeners('MatchCompleted');
  bus.emit('MatchCompleted', createMockMatchEvent());
  assert.strictEqual(callCount, 1);
});

// 21. High-Frequency Burst Metrics Timing Calculation
test('Tier 2 Boundary: Evaluation Trace Performance Timing evalTimeMs is Positive Integer', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const trace = await engine.evaluateMatch(createMockMatchEvent());
  assert.strictEqual(typeof trace.evalTimeMs, 'number');
  assert.strictEqual(trace.evalTimeMs >= 1, true);
});

// 22. Empty Member List on Missing Key
test('Tier 2 Boundary: sMembers on Non-Existent Key Returns Empty Array []', () => {
  const store = new KeyValueStore();
  assert.deepStrictEqual(store.sMembers('ghost_set'), []);
});

// 23. Ledger History Status Filtering
test('Tier 2 Boundary: Ledger Preserves Chronological Order of GRANTED and DEDUPED Entries', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const t1 = {
    eventId: 't_hist1',
    ruleId: 'r_h',
    ruleName: 'Rule H',
    playerId: 'p_hist',
    reward: { type: 'COINS' as const, amount: 10 },
    idempotencyKey: 'dedup:p_hist:r_h:1',
    triggeredAt: 100,
    matchEventId: 'm1',
  };

  await dispatcher.dispatchReward(t1);
  await dispatcher.dispatchReward(t1);

  const ledger = dispatcher.getLedger();
  assert.strictEqual(ledger.length, 2);
  assert.strictEqual(ledger[0].status, 'GRANTED');
  assert.strictEqual(ledger[1].status, 'DEDUPED');
  assert.strictEqual(ledger[0].idempotencyKey, ledger[1].idempotencyKey);
});

// 24. Zero Duration TTL Setting
test('Tier 2 Boundary: Zero Duration TTL Setting (ttlSeconds = 0) Acts as Persistent Key', () => {
  const store = new KeyValueStore();
  store.set('zero_ttl_key', 'val', 0);
  assert.strictEqual(store.get('zero_ttl_key'), 'val');
  assert.strictEqual(store.ttl('zero_ttl_key'), -1);
});

// 25. Concurrent Atomic Counter Increments
test('Tier 2 Boundary: KeyValueStore incrBy Handles Sequential Atomic Increments Accurately', () => {
  const store = new KeyValueStore();
  const key = 'atomic_key';

  for (let i = 0; i < 100; i++) {
    store.incrBy(key, 1);
  }

  assert.strictEqual(store.get(key), '100');
});
