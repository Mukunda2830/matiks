import test from 'node:test';
import assert from 'node:assert';
import { KeyValueStore, EventBus, RewardDispatcher, RuleEngine } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent } from '../harness/mockData.ts';

test('F10: State Inspector & Metrics - Player Inventory Aggregation', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_inv_1';
  // 3 wins to trigger 50 coins streak reward
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN' }));

  const state = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(state.inventory.coins, 50);
  assert.strictEqual(state.dailyWinCount, 3);
  assert.strictEqual(state.dailyMatchCount, 3);
});

test('F10: State Inspector & Metrics - System Metrics Event Counting', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  assert.strictEqual(engine.getMetrics().eventsProcessed, 0);

  await engine.evaluateMatch(createMockMatchEvent());
  await engine.evaluateMatch(createMockMatchEvent());

  const metrics = engine.getMetrics();
  assert.strictEqual(metrics.eventsProcessed, 2);
  assert.strictEqual(typeof metrics.avgEvalTimeMs, 'number');
});

test('F10: State Inspector & Metrics - Granted vs Deduped Counter Alignment', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_metrics_dedup';
  // Win 3 -> triggers reward (Granted)
  for (let i = 0; i < 3; i++) {
    await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN', timestamp: 1000 }));
  }

  const initialMetrics = engine.getMetrics();
  assert.strictEqual(initialMetrics.rewardsGranted, 2);
  assert.strictEqual(initialMetrics.rewardsDeduped, 1);

  // Trigger same reward again in same time bucket -> (Deduped)
  const triggerCopy = {
    eventId: 't_dup',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: pId,
    reward: { type: 'COINS' as const, amount: 50 },
    idempotencyKey: `dedup:${pId}:rule_streak_3_wins:0`,
    triggeredAt: Date.now(),
    matchEventId: 'm_dup',
  };

  await dispatcher.dispatchReward(triggerCopy);

  const updatedMetrics = engine.getMetrics();
  assert.strictEqual(updatedMetrics.rewardsGranted, 2);
  assert.strictEqual(updatedMetrics.rewardsDeduped, 2);
});

test('F10: State Inspector & Metrics - Active Multiplier TTL Expiration in State Inspector', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const pId = 'p_mult_exp';
  const state = dispatcher.getOrCreatePlayerState(pId);

  // Add expired multiplier
  state.activeMultipliers.push({
    id: 'm_old',
    ruleId: 'r_old',
    multiplier: 2,
    grantedAt: Date.now() - 10000,
    expiresAt: Date.now() - 1000, // expired 1 sec ago
  });

  // Add active multiplier
  state.activeMultipliers.push({
    id: 'm_act',
    ruleId: 'r_act',
    multiplier: 3,
    grantedAt: Date.now(),
    expiresAt: Date.now() + 60000, // valid for 60s
  });

  // Reading player state should filter out the expired multiplier
  const refreshedState = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(refreshedState.activeMultipliers.length, 1);
  assert.strictEqual(refreshedState.activeMultipliers[0].id, 'm_act');
});

test('F10: State Inspector & Metrics - Reset Metrics Method Resets All Counters', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  await engine.evaluateMatch(createMockMatchEvent());
  assert.strictEqual(engine.getMetrics().eventsProcessed, 1);

  engine.reset();
  const resetMetrics = engine.getMetrics();
  assert.strictEqual(resetMetrics.eventsProcessed, 0);
  assert.strictEqual(resetMetrics.rewardsGranted, 0);
  assert.strictEqual(resetMetrics.rewardsDeduped, 0);
});

test('F10: State Inspector & Metrics - Player State Timestamp Freshness', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const pId = 'p_fresh';
  const state = dispatcher.getOrCreatePlayerState(pId);
  const initialTimestamp = state.lastUpdated;

  await new Promise((r) => setTimeout(r, 10));

  // Trigger reward updates lastUpdated timestamp
  const trigger = {
    eventId: 't_fresh',
    ruleId: 'r_fresh',
    ruleName: 'Fresh Rule',
    playerId: pId,
    reward: { type: 'COINS' as const, amount: 10 },
    idempotencyKey: `dedup:${pId}:r_fresh:1`,
    triggeredAt: Date.now(),
    matchEventId: 'm_fresh',
  };

  await dispatcher.dispatchReward(trigger);
  const updatedState = dispatcher.getOrCreatePlayerState(pId);
  assert.strictEqual(updatedState.lastUpdated > initialTimestamp, true);
});
