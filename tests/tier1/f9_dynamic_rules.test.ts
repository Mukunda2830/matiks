import test from 'node:test';
import assert from 'node:assert';
import { KeyValueStore, EventBus, RewardDispatcher, RuleEngine } from '../harness/TestEngineHarness.ts';
import type { Rule } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent } from '../harness/mockData.ts';

test('F9: Dynamic Rules - Register New Rule at Runtime', () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const initialCount = engine.getRules().length;

  const dynamicRule: Rule = {
    id: 'dyn_streak_1',
    name: 'Dynamic 1 Win Streak',
    description: 'Instant 100 coins for single win',
    type: 'STREAK',
    targetCount: 1,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 100 },
    enabled: true,
    createdAt: Date.now(),
  };

  engine.registerRule(dynamicRule);
  assert.strictEqual(engine.getRules().length, initialCount + 1);
});

test('F9: Dynamic Rules - Immediate Evaluation of Newly Registered Rule', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const dynamicRule: Rule = {
    id: 'dyn_instant_coins',
    name: 'Instant 1 Win',
    description: '',
    type: 'STREAK',
    targetCount: 1,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 77 },
    enabled: true,
    createdAt: Date.now(),
  };

  engine.registerRule(dynamicRule);

  const trace = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'player_dyn_1', result: 'WIN' }));

  const dynResult = trace.evaluatedRules.find((r) => r.ruleId === 'dyn_instant_coins');
  assert.notStrictEqual(dynResult, undefined);
  assert.strictEqual(dynResult!.triggered, true);

  const state = dispatcher.getOrCreatePlayerState('player_dyn_1');
  assert.strictEqual(state.inventory.coins, 77);
});

test('F9: Dynamic Rules - Dynamic Rule with Custom Category Filter', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const physicsRule: Rule = {
    id: 'dyn_physics_master',
    name: 'Physics Master',
    description: '',
    type: 'COUNT_IN_WINDOW',
    targetCount: 1,
    category: 'physics',
    resultFilter: 'WIN',
    windowSeconds: 600,
    reward: { type: 'LOOT_BOX', amount: 3 },
    enabled: true,
    createdAt: Date.now(),
  };

  engine.registerRule(physicsRule);

  const traceChem = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_cat', category: 'chemistry', result: 'WIN' }));
  assert.strictEqual(traceChem.grantedRewards.some((g) => g.ruleId === 'dyn_physics_master'), false);

  const tracePhys = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_cat', category: 'physics', result: 'WIN' }));
  assert.strictEqual(tracePhys.grantedRewards.some((g) => g.ruleId === 'dyn_physics_master'), true);
});

test('F9: Dynamic Rules - Dynamic Rule Overlap with Seed Rules', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const dynRule: Rule = {
    id: 'dyn_1_win',
    name: 'First Win Bonus',
    description: '',
    type: 'STREAK',
    targetCount: 1,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 10 },
    enabled: true,
    createdAt: Date.now(),
  };
  engine.registerRule(dynRule);

  const trace = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_overlap', result: 'WIN' }));
  
  assert.strictEqual(trace.grantedRewards.some((g) => g.ruleId === 'dyn_1_win'), true);
  assert.strictEqual(trace.grantedRewards.some((g) => g.ruleId === 'rule_streak_3_wins'), false);
});

test('F9: Dynamic Rules - Disabled Dynamic Rule Ignored During Evaluation', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const disabledDynRule: Rule = {
    id: 'dyn_disabled',
    name: 'Disabled Rule',
    description: '',
    type: 'STREAK',
    targetCount: 1,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 999 },
    enabled: false,
    createdAt: Date.now(),
  };

  engine.registerRule(disabledDynRule);

  const trace = await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_dis', result: 'WIN' }));
  assert.strictEqual(trace.candidateRuleIds.includes('dyn_disabled'), false);
  assert.strictEqual(trace.grantedRewards.some((g) => g.ruleId === 'dyn_disabled'), false);
});

test('F9: Dynamic Rules - Multiplier Dynamic Rule Duration and State', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);
  const engine = new RuleEngine(store, bus, dispatcher);

  const multRule: Rule = {
    id: 'dyn_3x_mult',
    name: '3x Multiplier Rule',
    description: '',
    type: 'STREAK',
    targetCount: 1,
    resultFilter: 'WIN',
    reward: { type: 'MULTIPLIER', amount: 3, durationSeconds: 60 },
    enabled: true,
    createdAt: Date.now(),
  };

  engine.registerRule(multRule);

  await engine.evaluateMatch(createMockMatchEvent({ playerId: 'p_mult', result: 'WIN' }));

  const state = dispatcher.getOrCreatePlayerState('p_mult');
  assert.strictEqual(state.activeMultipliers.length, 1);
  assert.strictEqual(state.activeMultipliers[0].multiplier, 3);
});
