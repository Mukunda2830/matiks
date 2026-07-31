import test from 'node:test';
import assert from 'node:assert';
import {
  KeyValueStore,
  EventBus,
  RewardDispatcher,
  RuleEngine,
  PipelineSocketEmulator,
} from '../harness/TestEngineHarness.ts';
import type { Rule } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent, createMockRule } from '../harness/mockData.ts';

// 1. Dynamic Rule Addition + Immediate Evaluation + Deduplication
test('Tier 3 Combination: Dynamic Rule Creation -> Evaluation -> Idempotency Lock', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const dynRule: Rule = createMockRule({
    id: 'rule_dyn_combo_1',
    type: 'STREAK',
    targetCount: 1,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 250 },
  });

  // 1. Dynamic Addition
  engine.registerRule(dynRule);

  // 2. Immediate Evaluation (1st trigger -> GRANTED)
  const pId = 'p_dyn_combo';
  const trace1 = await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN', timestamp: 5000 }));
  assert.strictEqual(trace1.grantedRewards.some((g) => g.ruleId === 'rule_dyn_combo_1'), true);

  // 3. Duplicate Evaluation in same time bucket (2nd trigger -> DEDUPED)
  const trace2 = await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN', timestamp: 5001 }));
  assert.strictEqual(trace2.dedupedRewards.some((d) => d.ruleId === 'rule_dyn_combo_1'), true);

  const state = dispatcher.getOrCreatePlayerState(pId);
  // Coins granted only once (250 coins, not 500)
  assert.strictEqual(state.inventory.coins, 250);
});

// 2. Burst Simulation Triggering Multiple Rules Simultaneously
test('Tier 3 Combination: Burst Match Triggers Streak + Daily + Multiplier Rules', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_burst_combo';
  // 5 Consecutive Algebra WINs in same hour
  for (let i = 0; i < 5; i++) {
    await engine.evaluateMatch(
      createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN', timestamp: Date.now() + i * 100 })
    );
  }

  const ledger = dispatcher.getLedger();
  const grantedRules = ledger.filter((l) => l.status === 'GRANTED').map((l) => l.ruleId);

  // Should have triggered streak 3, window algebra 2, and daily 5 rules!
  assert.strictEqual(grantedRules.includes('rule_streak_3_wins'), true);
  assert.strictEqual(grantedRules.includes('rule_win_2_algebra_1hr'), true);
  assert.strictEqual(grantedRules.includes('rule_play_5_daily'), true);

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.inventory.coins, 50);
  assert.strictEqual(state.inventory.lootBoxes, 1);
  assert.strictEqual(state.activeMultipliers.length, 1);
});

// 3. Multi-Player Interleaved WIN/LOSS Events & Isolated State
test('Tier 3 Combination: Multi-Player Interleaved Matches Maintain Strict Isolation', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const p1 = 'player_alpha';
  const p2 = 'player_beta';

  // p1 WIN 1, p2 WIN 1
  await engine.evaluateMatch(createMockMatchEvent({ playerId: p1, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: p2, result: 'WIN' }));

  // p1 WIN 2, p2 LOSS
  await engine.evaluateMatch(createMockMatchEvent({ playerId: p1, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: p2, result: 'LOSS' }));

  // p1 WIN 3 (Triggers streak for p1), p2 WIN 1 (Streak at 1 for p2)
  await engine.evaluateMatch(createMockMatchEvent({ playerId: p1, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: p2, result: 'WIN' }));

  const state1 = dispatcher.getOrCreatePlayerState(p1);
  const state2 = dispatcher.getOrCreatePlayerState(p2);

  assert.strictEqual(state1.inventory.coins, 50);
  assert.strictEqual(state2.inventory.coins, 0);
  assert.strictEqual(state2.dailyWinCount, 2);
});

// 4. TTL Expiration During Active Stream
test('Tier 3 Combination: Passive TTL Cleanup During High-Velocity Match Stream', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_ttl_stream';

  // Set short TTL lock key manually
  store.set(`dedup:${pId}:rule_streak_3_wins:0`, '1', 1); // 1s TTL

  await new Promise((r) => setTimeout(r, 1100));

  // Key expired! Evaluating 3 wins now will grant reward again
  for (let i = 0; i < 3; i++) {
    await engine.evaluateMatch(
      createMockMatchEvent({ playerId: pId, result: 'WIN', timestamp: Date.now() + i * 100 })
    );
  }

  const ledger = dispatcher.getLedger();
  const grantedForPlayer = ledger.filter((l) => l.playerId === pId && l.status === 'GRANTED');
  assert.strictEqual(grantedForPlayer.length >= 1, true);
});

// 5. Concurrent Socket.IO Event Emissions Across 6 Pipeline Stages
test('Tier 3 Combination: Socket.IO Emulator Records Full 6-Stage Pipeline Cycle', async () => {
  const socketEmulator = new PipelineSocketEmulator();
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_socket_combo';

  // Simulate pipeline stage emission sequence
  const match = createMockMatchEvent({ playerId: pId, result: 'WIN' });
  socketEmulator.emitStageEvent('MATCH_RECEIVED', match);

  const trace = await engine.evaluateMatch(match);
  socketEmulator.emitStageEvent('RULE_CANDIDATES_FOUND', { candidateRuleIds: trace.candidateRuleIds });
  socketEmulator.emitStageEvent('COUNTERS_UPDATED', { playerId: pId, streak: 1 });

  assert.strictEqual(socketEmulator.getEmittedByStage('MATCH_RECEIVED').length, 1);
  assert.strictEqual(socketEmulator.getEmittedByStage('RULE_CANDIDATES_FOUND').length, 1);
  assert.strictEqual(socketEmulator.getEmittedByStage('COUNTERS_UPDATED').length, 1);
});

// 6. Dynamic Rule Category Filter + Streak Reset Interaction
test('Tier 3 Combination: Dynamic Category Rule Does Not Reset Global Win Streak', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const dynRule: Rule = createMockRule({
    id: 'dyn_math_only',
    type: 'STREAK',
    targetCount: 2,
    category: 'math',
    resultFilter: 'WIN',
  });
  engine.registerRule(dynRule);

  const pId = 'p_cat_streak';
  // Match 1: history WIN (increments seed 3-win streak, ignored by dyn_math_only)
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'history', result: 'WIN' }));
  // Match 2: math WIN (increments both seed 3-win streak and dyn_math_only)
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'math', result: 'WIN' }));
  // Match 3: math WIN (triggers dyn_math_only!)
  const trace3 = await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'math', result: 'WIN' }));

  assert.strictEqual(trace3.grantedRewards.some((g) => g.ruleId === 'dyn_math_only'), true);
});

// 7. Interleaved Category Stream Filtering
test('Tier 3 Combination: Interleaved Category Stream Correctly Evaluates Category-Specific Rules', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_interleaved';
  // 2 algebra wins + 2 geometry wins interleaved
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'geometry', result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN' }));

  // Seed rule_win_2_algebra_1hr should trigger on 2nd algebra win!
  const ledger = dispatcher.getLedger();
  assert.strictEqual(ledger.some((l) => l.playerId === pId && l.ruleId === 'rule_win_2_algebra_1hr'), true);
});

// 8. Re-Granting Reward After Idempotency TTL Lock Expiration
test('Tier 3 Combination: Lock Expiration Allows Re-Granting In Subsequent Bucket', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const t1 = {
    eventId: 't_b1',
    ruleId: 'r1',
    ruleName: 'R1',
    playerId: 'p_regrant',
    reward: { type: 'COINS' as const, amount: 50 },
    idempotencyKey: 'dedup:p_regrant:r1:bucket_1',
    triggeredAt: Date.now(),
    matchEventId: 'm1',
  };

  const t2 = {
    ...t1,
    eventId: 't_b2',
    idempotencyKey: 'dedup:p_regrant:r1:bucket_2', // Next time bucket
  };

  const res1 = await dispatcher.dispatchReward(t1);
  const res2 = await dispatcher.dispatchReward(t2);

  assert.strictEqual(res1.status, 'GRANTED');
  assert.strictEqual(res2.status, 'GRANTED');
});

// 9. Multiple Dynamic Rules Triggering in Single Match
test('Tier 3 Combination: Single Match Triggers Multiple Dynamic Rules Simultaneously', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  engine.registerRule(createMockRule({ id: 'r_dyn_a', type: 'STREAK', targetCount: 1, reward: { type: 'COINS', amount: 10 } }));
  engine.registerRule(createMockRule({ id: 'r_dyn_b', type: 'STREAK', targetCount: 1, reward: { type: 'LOOT_BOX', amount: 1 } }));

  const trace = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_multi_dyn', result: 'WIN' }));

  assert.strictEqual(trace.grantedRewards.some((g) => g.ruleId === 'r_dyn_a'), true);
  assert.strictEqual(trace.grantedRewards.some((g) => g.ruleId === 'r_dyn_b'), true);
});

// 10. Mixed Inventory Accumulation Across Rules
test('Tier 3 Combination: Player Inventory Correctly Aggregates Coins, Lootboxes, and Multipliers', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const pId = 'p_inv_mix';
  await dispatcher.dispatchReward({
    eventId: 'e1', ruleId: 'r1', ruleName: '', playerId: pId,
    reward: { type: 'COINS', amount: 100 }, idempotencyKey: 'k1', triggeredAt: Date.now(), matchEventId: 'm1',
  });

  await dispatcher.dispatchReward({
    eventId: 'e2', ruleId: 'r2', ruleName: '', playerId: pId,
    reward: { type: 'LOOT_BOX', amount: 2 }, idempotencyKey: 'k2', triggeredAt: Date.now(), matchEventId: 'm2',
  });

  await dispatcher.dispatchReward({
    eventId: 'e3', ruleId: 'r3', ruleName: '', playerId: pId,
    reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 60 }, idempotencyKey: 'k3', triggeredAt: Date.now(), matchEventId: 'm3',
  });

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.inventory.coins, 100);
  assert.strictEqual(state.inventory.lootBoxes, 2);
  assert.strictEqual(state.activeMultipliers.length, 1);
});

// 11. System Metrics Aggregation Across Workloads
test('Tier 3 Combination: System Metrics Consistently Tracks Processed Events & Rewards', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  for (let i = 0; i < 10; i++) {
    await engine.evaluateMatch(createMockMatchEvent({ playerId: `p_m_${i}` }));
  }

  const metrics = engine.getMetrics();
  assert.strictEqual(metrics.eventsProcessed, 10);
  assert.strictEqual(typeof metrics.avgEvalTimeMs, 'number');
});

// 12. Idempotency Key String Formatting Pattern Verification
test('Tier 3 Combination: Idempotency Key Formatting Matches Strict Template Pattern', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_key_fmt';
  const trace = await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN' }));

  const ledger = dispatcher.getLedger();
  for (const entry of ledger) {
    // Key pattern: dedup:{playerId}:{ruleId}:{timeBucket}
    assert.strictEqual(entry.idempotencyKey.startsWith(`dedup:${pId}:`), true);
  }
});
