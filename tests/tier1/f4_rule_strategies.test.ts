import test from 'node:test';
import assert from 'node:assert';
import {
  KeyValueStore,
  StreakRuleStrategy,
  CountInDayRuleStrategy,
  CountInWindowRuleStrategy,
} from '../harness/TestEngineHarness.ts';
import type { Rule } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent } from '../harness/mockData.ts';

test('F4: Rule Strategies - StreakRuleStrategy Evaluates Consecutive Wins', async () => {
  const store = new KeyValueStore();
  const strategy = new StreakRuleStrategy();
  const rule: Rule = {
    id: 'streak_3',
    name: 'Streak 3',
    description: '',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 50 },
    enabled: true,
    createdAt: Date.now(),
  };

  const match1 = createMockMatchEvent({ playerId: 'p_streak', result: 'WIN' });
  const res1 = await strategy.evaluate(rule, match1, store);
  assert.strictEqual(res1.currentProgress, 1);
  assert.strictEqual(res1.triggered, false);

  const match2 = createMockMatchEvent({ playerId: 'p_streak', result: 'WIN' });
  const res2 = await strategy.evaluate(rule, match2, store);
  assert.strictEqual(res2.currentProgress, 2);
  assert.strictEqual(res2.triggered, false);

  const match3 = createMockMatchEvent({ playerId: 'p_streak', result: 'WIN' });
  const res3 = await strategy.evaluate(rule, match3, store);
  assert.strictEqual(res3.currentProgress, 3);
  assert.strictEqual(res3.triggered, true);
});

test('F4: Rule Strategies - StreakRuleStrategy Category Filter', async () => {
  const store = new KeyValueStore();
  const strategy = new StreakRuleStrategy();
  const rule: Rule = {
    id: 'streak_algebra',
    name: '',
    description: '',
    type: 'STREAK',
    targetCount: 2,
    category: 'algebra',
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 10 },
    enabled: true,
    createdAt: Date.now(),
  };

  const geomMatch = createMockMatchEvent({ playerId: 'p1', category: 'geometry', result: 'WIN' });
  const resGeom = await strategy.evaluate(rule, geomMatch, store);
  assert.strictEqual(resGeom.triggered, false);
  assert.strictEqual(resGeom.currentProgress, 0);

  const algMatch = createMockMatchEvent({ playerId: 'p1', category: 'algebra', result: 'WIN' });
  const resAlg = await strategy.evaluate(rule, algMatch, store);
  assert.strictEqual(resAlg.currentProgress, 1);
});

test('F4: Rule Strategies - CountInDayRuleStrategy Accumulates Daily Matches', async () => {
  const store = new KeyValueStore();
  const strategy = new CountInDayRuleStrategy();
  const rule: Rule = {
    id: 'daily_5',
    name: 'Daily 5',
    description: '',
    type: 'COUNT_IN_DAY',
    targetCount: 5,
    reward: { type: 'LOOT_BOX', amount: 1 },
    enabled: true,
    createdAt: Date.now(),
  };

  for (let i = 1; i <= 4; i++) {
    const match = createMockMatchEvent({ playerId: 'p_daily' });
    const res = await strategy.evaluate(rule, match, store);
    assert.strictEqual(res.currentProgress, i);
    assert.strictEqual(res.triggered, false);
  }

  const match5 = createMockMatchEvent({ playerId: 'p_daily' });
  const res5 = await strategy.evaluate(rule, match5, store);
  assert.strictEqual(res5.currentProgress, 5);
  assert.strictEqual(res5.triggered, true);
});

test('F4: Rule Strategies - CountInWindowRuleStrategy Filters Out Expired Window Entries', async () => {
  const store = new KeyValueStore();
  const strategy = new CountInWindowRuleStrategy();
  const rule: Rule = {
    id: 'window_2_1hr',
    name: 'Window 2 in 1 hr',
    description: '',
    type: 'COUNT_IN_WINDOW',
    targetCount: 2,
    category: 'algebra',
    resultFilter: 'WIN',
    windowSeconds: 3600,
    reward: { type: 'MULTIPLIER', amount: 2 },
    enabled: true,
    createdAt: Date.now(),
  };

  const now = Date.now();
  const oldTimestamp = now - 4000 * 1000;

  const oldMatch = createMockMatchEvent({ playerId: 'p_win', category: 'algebra', result: 'WIN', timestamp: oldTimestamp });
  await strategy.evaluate(rule, oldMatch, store);

  const currentMatch1 = createMockMatchEvent({ playerId: 'p_win', category: 'algebra', result: 'WIN', timestamp: now });
  const res1 = await strategy.evaluate(rule, currentMatch1, store);

  assert.strictEqual(res1.currentProgress, 1);
  assert.strictEqual(res1.triggered, false);

  const currentMatch2 = createMockMatchEvent({ playerId: 'p_win', category: 'algebra', result: 'WIN', timestamp: now + 100 });
  const res2 = await strategy.evaluate(rule, currentMatch2, store);
  assert.strictEqual(res2.currentProgress, 2);
  assert.strictEqual(res2.triggered, true);
});

test('F4: Rule Strategies - Strategy Selection Handles Unknown Types Gracefully', async () => {
  const store = new KeyValueStore();
  const strategy = new StreakRuleStrategy();
  const rule: Rule = {
    id: 'unknown_type',
    name: 'Unknown',
    description: '',
    type: 'STREAK',
    targetCount: 1,
    reward: { type: 'COINS', amount: 5 },
    enabled: true,
    createdAt: Date.now(),
  };

  const match = createMockMatchEvent({ result: 'WIN' });
  const res = await strategy.evaluate(rule, match, store);
  assert.strictEqual(res.triggered, true);
});

test('F4: Rule Strategies - Result Filter Matching across Strategies', async () => {
  const store = new KeyValueStore();
  const strategy = new CountInDayRuleStrategy();
  const winOnlyRule: Rule = {
    id: 'daily_wins_only',
    name: '',
    description: '',
    type: 'COUNT_IN_DAY',
    targetCount: 2,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 20 },
    enabled: true,
    createdAt: Date.now(),
  };

  const lossMatch = createMockMatchEvent({ playerId: 'p_res_filter', result: 'LOSS' });
  const resLoss = await strategy.evaluate(winOnlyRule, lossMatch, store);
  assert.strictEqual(resLoss.currentProgress, 0);

  const winMatch = createMockMatchEvent({ playerId: 'p_res_filter', result: 'WIN' });
  const resWin = await strategy.evaluate(winOnlyRule, winMatch, store);
  assert.strictEqual(resWin.currentProgress, 1);
});
