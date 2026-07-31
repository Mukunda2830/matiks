import test from 'node:test';
import assert from 'node:assert';
import { getSeedRules } from '../harness/TestEngineHarness.ts';

test('F3: Seed Rules - Verify Seed Rule Count', () => {
  const seeds = getSeedRules();
  assert.strictEqual(seeds.length, 3);
});

test('F3: Seed Rules - Streak Rule Specifications (rule_streak_3_wins)', () => {
  const seeds = getSeedRules();
  const streakRule = seeds.find((r) => r.id === 'rule_streak_3_wins');

  assert.notStrictEqual(streakRule, undefined);
  assert.strictEqual(streakRule!.type, 'STREAK');
  assert.strictEqual(streakRule!.targetCount, 3);
  assert.strictEqual(streakRule!.resultFilter, 'WIN');
  assert.strictEqual(streakRule!.reward.type, 'COINS');
  assert.strictEqual(streakRule!.reward.amount, 50);
  assert.strictEqual(streakRule!.enabled, true);
});

test('F3: Seed Rules - Daily Count Rule Specifications (rule_play_5_daily)', () => {
  const seeds = getSeedRules();
  const dailyRule = seeds.find((r) => r.id === 'rule_play_5_daily');

  assert.notStrictEqual(dailyRule, undefined);
  assert.strictEqual(dailyRule!.type, 'COUNT_IN_DAY');
  assert.strictEqual(dailyRule!.targetCount, 5);
  assert.strictEqual(dailyRule!.reward.type, 'LOOT_BOX');
  assert.strictEqual(dailyRule!.reward.amount, 1);
  assert.strictEqual(dailyRule!.enabled, true);
});

test('F3: Seed Rules - Windowed Algebra Multiplier Rule Specifications (rule_win_2_algebra_1hr)', () => {
  const seeds = getSeedRules();
  const windowRule = seeds.find((r) => r.id === 'rule_win_2_algebra_1hr');

  assert.notStrictEqual(windowRule, undefined);
  assert.strictEqual(windowRule!.type, 'COUNT_IN_WINDOW');
  assert.strictEqual(windowRule!.targetCount, 2);
  assert.strictEqual(windowRule!.category, 'algebra');
  assert.strictEqual(windowRule!.resultFilter, 'WIN');
  assert.strictEqual(windowRule!.windowSeconds, 3600);
  assert.strictEqual(windowRule!.reward.type, 'MULTIPLIER');
  assert.strictEqual(windowRule!.reward.amount, 2);
  assert.strictEqual(windowRule!.reward.durationSeconds, 1800);
  assert.strictEqual(windowRule!.enabled, true);
});

test('F3: Seed Rules - Immutability of getSeedRules Array', () => {
  const seeds1 = getSeedRules();
  seeds1[0].name = 'Modified Name';

  const seeds2 = getSeedRules();
  assert.notStrictEqual(seeds2[0].name, 'Modified Name');
  assert.strictEqual(seeds2[0].name, '3 Win Streak');
});

test('F3: Seed Rules - All Seed Rules Default to Enabled and Have Valid Timestamps', () => {
  const seeds = getSeedRules();
  for (const rule of seeds) {
    assert.strictEqual(rule.enabled, true);
    assert.strictEqual(typeof rule.createdAt, 'number');
    assert.strictEqual(rule.createdAt > 0, true);
  }
});
