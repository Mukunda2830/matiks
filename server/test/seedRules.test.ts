import { describe, it, expect } from 'vitest';
import { getSeedRules, SEED_RULES } from '../src/domain/seedRules';

describe('Seed Rules', () => {
  it('should load 3 default seed rules', () => {
    const rules = getSeedRules();
    expect(rules).toHaveLength(3);
  });

  it('should validate Streak 3 wins seed rule', () => {
    const rules = getSeedRules();
    const streakRule = rules.find((r) => r.id === 'rule_streak_3_wins');

    expect(streakRule).toBeDefined();
    expect(streakRule?.type).toBe('STREAK');
    expect(streakRule?.targetCount).toBe(3);
    expect(streakRule?.resultFilter).toBe('WIN');
    expect(streakRule?.reward.type).toBe('COINS');
    expect(streakRule?.reward.amount).toBe(50);
    expect(streakRule?.enabled).toBe(true);
  });

  it('should validate Play 5/day seed rule', () => {
    const rules = getSeedRules();
    const dailyRule = rules.find((r) => r.id === 'rule_play_5_daily');

    expect(dailyRule).toBeDefined();
    expect(dailyRule?.type).toBe('COUNT_IN_DAY');
    expect(dailyRule?.targetCount).toBe(5);
    expect(dailyRule?.reward.type).toBe('LOOT_BOX');
    expect(dailyRule?.reward.amount).toBe(1);
    expect(dailyRule?.enabled).toBe(true);
  });

  it('should validate Win 2 algebra in 1hr seed rule', () => {
    const rules = getSeedRules();
    const windowRule = rules.find((r) => r.id === 'rule_win_2_algebra_1hr');

    expect(windowRule).toBeDefined();
    expect(windowRule?.type).toBe('COUNT_IN_WINDOW');
    expect(windowRule?.targetCount).toBe(2);
    expect(windowRule?.category).toBe('algebra');
    expect(windowRule?.resultFilter).toBe('WIN');
    expect(windowRule?.windowSeconds).toBe(3600);
    expect(windowRule?.reward.type).toBe('MULTIPLIER');
    expect(windowRule?.reward.amount).toBe(2);
    expect(windowRule?.reward.durationSeconds).toBe(1800);
    expect(windowRule?.enabled).toBe(true);
  });

  it('should return a fresh deep copy on each getSeedRules call', () => {
    const copy1 = getSeedRules();
    copy1[0].name = 'Mutated Name';

    const copy2 = getSeedRules();
    expect(copy2[0].name).not.toBe('Mutated Name');
    expect(SEED_RULES[0].name).not.toBe('Mutated Name');
  });
});
