import { Rule } from './models';

export const SEED_RULES: Rule[] = [
  {
    id: 'rule_streak_3_wins',
    name: '3 Win Streak',
    description: 'Win 3 matches in a row to earn 50 coins',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'WIN',
    reward: {
      type: 'COINS',
      amount: 50,
    },
    enabled: true,
    createdAt: Date.now(),
  },
  {
    id: 'rule_play_5_daily',
    name: 'Daily 5 Matches',
    description: 'Play 5 matches in a day to earn 1 loot box',
    type: 'COUNT_IN_DAY',
    targetCount: 5,
    reward: {
      type: 'LOOT_BOX',
      amount: 1,
    },
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
    reward: {
      type: 'MULTIPLIER',
      amount: 2,
      durationSeconds: 1800,
    },
    enabled: true,
    createdAt: Date.now(),
  },
];

export function getSeedRules(): Rule[] {
  return JSON.parse(JSON.stringify(SEED_RULES));
}
