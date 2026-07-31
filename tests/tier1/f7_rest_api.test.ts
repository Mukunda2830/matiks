import test from 'node:test';
import assert from 'node:assert';
import { KeyValueStore, EventBus, RewardDispatcher, RuleEngine } from '../harness/TestEngineHarness.ts';
import type { Rule } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent, createMockRule } from '../harness/mockData.ts';

test('F7: REST API - POST /api/simulate-match Evaluation Trace Response', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const matchEvent = createMockMatchEvent({ playerId: 'player_api_1', result: 'WIN', category: 'algebra' });
  const trace = await engine.evaluateMatch(matchEvent);

  assert.notStrictEqual(trace, null);
  assert.strictEqual(trace.matchEvent.playerId, 'player_api_1');
  assert.strictEqual(Array.isArray(trace.candidateRuleIds), true);
  assert.strictEqual(Array.isArray(trace.evaluatedRules), true);
  assert.strictEqual(typeof trace.evalTimeMs, 'number');
});

test('F7: REST API - POST /api/simulate-burst Trigger Summary', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const burstCount = 5;
  let totalGranted = 0;
  let totalDeduped = 0;

  for (let i = 0; i < burstCount; i++) {
    const match = createMockMatchEvent({ playerId: 'player_burst_1', result: 'WIN' });
    const trace = await engine.evaluateMatch(match);
    totalGranted += trace.grantedRewards.length;
    totalDeduped += trace.dedupedRewards.length;
  }

  assert.strictEqual(engine.getMetrics().eventsProcessed, burstCount);
  assert.strictEqual(totalGranted >= 1, true);
});

test('F7: REST API - GET /api/rules Returns All Configured Rules', () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const rules = engine.getRules();
  assert.strictEqual(rules.length >= 3, true);
  assert.strictEqual(rules.some((r) => r.id === 'rule_streak_3_wins'), true);
});

test('F7: REST API - POST /api/rules Adds Dynamic Rule', () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const newRule: Rule = createMockRule({
    id: 'rule_dynamic_api',
    name: 'API Test Rule',
    type: 'STREAK',
    targetCount: 1,
    reward: { type: 'COINS', amount: 500 },
  });

  engine.registerRule(newRule);
  const updatedRules = engine.getRules();
  assert.strictEqual(updatedRules.some((r) => r.id === 'rule_dynamic_api'), true);
});

test('F7: REST API - GET /api/players/:id/state State Structure', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const playerId = 'player_state_api';
  await engine.evaluateMatch(createMockMatchEvent({ playerId, result: 'WIN' }));

  const state = dispatcher.getOrCreatePlayerState(playerId);
  assert.strictEqual(state.playerId, playerId);
  assert.strictEqual(state.dailyMatchCount, 1);
  assert.strictEqual(state.dailyWinCount, 1);
  assert.strictEqual(typeof state.inventory.coins, 'number');
  assert.strictEqual(typeof state.inventory.lootBoxes, 'number');
});

test('F7: REST API - GET /api/ledger Returns Reward Audit History', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const pId = 'p_ledger';
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN' }));
  await engine.evaluateMatch(createMockMatchEvent({ playerId: pId, result: 'WIN' }));

  const ledger = dispatcher.getLedger();
  assert.strictEqual(ledger.length >= 1, true);
  assert.strictEqual(ledger[0].playerId, pId);
});
