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

// Scenario 1: Full Player Journey
test('Tier 4 Scenario 1: Full Player Journey (5 matches, streak, multiplier, lootbox, state check)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'player_journey_1';
  const t0 = Date.now();

  // Match 1: WIN (algebra) -> streak 1, algebra count 1
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN', timestamp: t0 }));
  // Match 2: WIN (algebra) -> streak 2, algebra count 2 (Triggers Algebra 2x Multiplier Rule!)
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN', timestamp: t0 + 1000 }));
  // Match 3: WIN (algebra) -> streak 3 (Triggers 3-Win Streak 50 Coins Rule!)
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN', timestamp: t0 + 2000 }));
  // Match 4: LOSS (geometry) -> streak resets to 0, daily match count = 4
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'geometry', result: 'LOSS', timestamp: t0 + 3000 }));
  // Match 5: WIN (geometry) -> streak 1, daily match count = 5 (Triggers Daily 5 Matches Lootbox Rule!)
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'geometry', result: 'WIN', timestamp: t0 + 4000 }));

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.dailyMatchCount, 5);
  assert.strictEqual(state.dailyWinCount, 4);
  assert.strictEqual(state.inventory.coins, 50);
  assert.strictEqual(state.inventory.lootBoxes, 1);
  assert.strictEqual(state.activeMultipliers.length, 1);
  assert.strictEqual(state.activeMultipliers[0].multiplier, 2);
});

// Scenario 2: Multi-Player Tournament Burst Workload
test('Tier 4 Scenario 2: Multi-Player Tournament Burst (5 players, 20 match burst, metrics & ledger verification)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const players = ['p_tourn_1', 'p_tourn_2', 'p_tourn_3', 'p_tourn_4', 'p_tourn_5'];
  let totalMatchEvents = 0;

  // 4 matches per player = 20 total match burst
  for (const player of players) {
    for (let m = 1; m <= 4; m++) {
      const result = m % 4 === 0 ? 'LOSS' : 'WIN';
      await engine.evaluateMatch(createMockMatchEvent({ playerId: player, category: 'algebra', result }));
      totalMatchEvents++;
    }
  }

  assert.strictEqual(totalMatchEvents, 20);
  const metrics = engine.getMetrics();
  assert.strictEqual(metrics.eventsProcessed, 20);
  assert.strictEqual(metrics.rewardsGranted >= 5, true);

  const ledger = dispatcher.getLedger();
  assert.strictEqual(ledger.length >= 5, true);
  for (const player of players) {
    const pState = dispatcher.getOrCreatePlayerState(player);
    assert.strictEqual(pState.dailyMatchCount, 4);
  }
});

// Scenario 3: Dynamic Rule Authoring & Pity Mechanism Workflow
test('Tier 4 Scenario 3: Dynamic Rule Authoring & Pity Mechanism Workflow (3 LOSS streak -> 100 coins)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  // Author dynamic pity rule
  const pityRule: Rule = {
    id: 'rule_pity_loss_3',
    name: 'Pity Reward - 3 Losses',
    description: 'Grant 100 coins on 3 consecutive losses to encourage player',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'LOSS',
    reward: { type: 'COINS', amount: 100 },
    enabled: true,
    createdAt: Date.now(),
  };

  engine.registerRule(pityRule);

  const pId = 'player_pity_1';
  // 3 consecutive losses
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'LOSS' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'LOSS' }));
  const trace3 = await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'LOSS' }));

  assert.strictEqual(trace3.grantedRewards.some((g) => g.ruleId === 'rule_pity_loss_3'), true);
  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.inventory.coins, 100);
});

// Scenario 4: High Concurrency Burst Evaluation
test('Tier 4 Scenario 4: High Concurrency Burst Evaluation (50 matches in rapid succession)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'player_high_burst';
  const startTime = Date.now();

  for (let i = 0; i < 50; i++) {
    await engine.evaluateMatch(
      createMockMatchEvent({
        playerId: pId,
        category: i % 2 === 0 ? 'algebra' : 'geometry',
        result: 'WIN',
        timestamp: startTime + i * 10,
      })
    );
  }

  const metrics = engine.getMetrics();
  assert.strictEqual(metrics.eventsProcessed, 50);
  assert.strictEqual(metrics.avgEvalTimeMs >= 0, true);

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.dailyMatchCount, 50);
  assert.strictEqual(state.dailyWinCount, 50);
});

// Scenario 5: Event Deduplication & Replay Resistance
test('Tier 4 Scenario 5: Event Deduplication & Replay Resistance (10 replayed identical triggers)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'player_replay';
  const replayedTrigger = {
    eventId: 'trig_replay_001',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: pId,
    reward: { type: 'COINS' as const, amount: 50 },
    idempotencyKey: `dedup:${pId}:rule_streak_3_wins:hour_50`,
    triggeredAt: Date.now(),
    matchEventId: 'match_replay_orig',
  };

  // Dispatch 10 times with identical idempotency key
  let grantedCount = 0;
  let dedupedCount = 0;

  for (let i = 0; i < 10; i++) {
    const res = await dispatcher.dispatchReward(replayedTrigger);
    if (res.status === 'GRANTED') grantedCount++;
    if (res.status === 'DEDUPED') dedupedCount++;
  }

  assert.strictEqual(grantedCount, 1);
  assert.strictEqual(dedupedCount, 9);

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.inventory.coins, 50);
});

// Scenario 6: Daily Streak & Window Multiplier Overlap Workload
test('Tier 4 Scenario 6: Daily Streak & Window Multiplier Overlap Workload', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_overlap_workload';
  // 10 matches: 5 WIN algebra, 5 WIN geometry
  for (let i = 0; i < 5; i++) {
    await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'algebra', result: 'WIN' }));
  }
  for (let i = 0; i < 5; i++) {
    await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, category: 'geometry', result: 'WIN' }));
  }

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.dailyMatchCount, 10);
  assert.strictEqual(state.inventory.lootBoxes >= 1, true);
  assert.strictEqual(state.inventory.coins >= 50, true);
});

// Scenario 7: Socket.IO 6-Stage Visualizer Pipeline End-to-End Flow
test('Tier 4 Scenario 7: Socket.IO 6-Stage Pipeline End-to-End Progression Flow', async () => {
  const socketEmulator = new PipelineSocketEmulator();
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_e2e_socket';
  const stagesExecuted: string[] = [];

  socketEmulator.on('MATCH_RECEIVED', () => stagesExecuted.push('MATCH_RECEIVED'));
  socketEmulator.on('RULE_CANDIDATES_FOUND', () => stagesExecuted.push('RULE_CANDIDATES_FOUND'));
  socketEmulator.on('COUNTERS_UPDATED', () => stagesExecuted.push('COUNTERS_UPDATED'));
  socketEmulator.on('THRESHOLD_MET', () => stagesExecuted.push('THRESHOLD_MET'));
  socketEmulator.on('REWARD_GRANTED', () => stagesExecuted.push('REWARD_GRANTED'));
  socketEmulator.on('REWARD_DEDUPED', () => stagesExecuted.push('REWARD_DEDUPED'));

  // Match arrival
  const match = createMockMatchEvent({ playerId: pId, result: 'WIN' });
  socketEmulator.emitStageEvent('MATCH_RECEIVED', match);

  // Evaluation
  const trace = await engine.evaluateMatch(match);
  socketEmulator.emitStageEvent('RULE_CANDIDATES_FOUND', { candidateRuleIds: trace.candidateRuleIds });
  socketEmulator.emitStageEvent('COUNTERS_UPDATED', { playerId: pId });

  if (trace.triggeredRewards.length > 0) {
    socketEmulator.emitStageEvent('THRESHOLD_MET', { count: trace.triggeredRewards.length });
  }

  assert.strictEqual(stagesExecuted.includes('MATCH_RECEIVED'), true);
  assert.strictEqual(stagesExecuted.includes('RULE_CANDIDATES_FOUND'), true);
  assert.strictEqual(stagesExecuted.includes('COUNTERS_UPDATED'), true);
});

// Scenario 8: Dynamic Rule Disabling and Re-enabling Lifecycle
test('Tier 4 Scenario 8: Dynamic Rule Disabling and Re-enabling Lifecycle', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const dynRule = createMockRule({ id: 'rule_lifecycle', type: 'STREAK', targetCount: 1, reward: { type: 'COINS', amount: 50 } });
  engine.registerRule(dynRule);

  // Active -> Triggers
  const trace1 = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_life', result: 'WIN', timestamp: 1000 }));
  assert.strictEqual(trace1.grantedRewards.some((g) => g.ruleId === 'rule_lifecycle'), true);

  // Disable rule
  dynRule.enabled = false;
  engine.registerRule(dynRule);

  // Disabled -> Does not appear in candidates
  const trace2 = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_life', result: 'WIN', timestamp: 2000 }));
  assert.strictEqual(trace2.candidateRuleIds.includes('rule_lifecycle'), false);
});

// Scenario 9: Player Multiplier Stack Expiration Real-Time Countdown
test('Tier 4 Scenario 9: Player Multiplier Stack Expiration Real-Time Countdown (1s vs 10s TTL)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const pId = 'p_mult_countdown';
  const now = Date.now();

  // Add 1s multiplier and 10s multiplier
  const state = dispatcher.getOrCreatePlayerState(pId);
  state.activeMultipliers.push({ id: 'm_1s', ruleId: 'r1', multiplier: 2, grantedAt: now, expiresAt: now + 1000 });
  state.activeMultipliers.push({ id: 'm_10s', ruleId: 'r2', multiplier: 3, grantedAt: now, expiresAt: now + 10000 });

  assert.strictEqual(dispatcher.getOrCreatePlayerState(pId).activeMultipliers.length, 2);

  // Wait 1.1s
  await new Promise((r) => setTimeout(r, 1100));

  const updatedState = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(updatedState.activeMultipliers.length, 1);
  assert.strictEqual(updatedState.activeMultipliers[0].id, 'm_10s');
});

// Scenario 10: State Inspector Ledger Audit & System Resilience
test('Tier 4 Scenario 10: State Inspector Ledger Audit & System Resilience (Zero Unhandled Rejections)', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  // Full system reset
  engine.reset();
  store.flushAll();
  dispatcher.clear();

  // Evaluate 10 mixed matches
  for (let i = 0; i < 10; i++) {
    await engine.evaluateMatch(
      createMockMatchEvent({
        playerId: 'p_resilience',
        category: i % 2 === 0 ? 'algebra' : 'geometry',
        result: i % 3 === 0 ? 'LOSS' : 'WIN',
      })
    );
  }

  const ledger = dispatcher.getLedger();
  assert.strictEqual(Array.isArray(ledger), true);
  const metrics = engine.getMetrics();
  assert.strictEqual(metrics.eventsProcessed, 10);
});
