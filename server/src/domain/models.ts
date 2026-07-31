export type RewardType = 'COINS' | 'LOOT_BOX' | 'MULTIPLIER';

export interface RewardConfig {
  type: RewardType;
  amount: number;
  durationSeconds?: number;
}

export type RuleType = 'STREAK' | 'COUNT_IN_DAY' | 'COUNT_IN_WINDOW';

export type MatchResult = 'WIN' | 'LOSS' | 'DRAW';

export interface MatchCompletedEvent {
  eventId: string;
  playerId: string;
  matchId: string;
  category: string;
  result: MatchResult;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  type: RuleType;
  targetCount: number;
  category?: string;
  resultFilter?: MatchResult;
  windowSeconds?: number;
  reward: RewardConfig;
  enabled: boolean;
  createdAt: number;
}

export interface RewardTriggeredEvent {
  eventId: string;
  ruleId: string;
  ruleName: string;
  playerId: string;
  reward: RewardConfig;
  idempotencyKey: string;
  triggeredAt: number;
  matchEventId: string;
}

export interface ActiveMultiplier {
  id: string;
  ruleId: string;
  multiplier: number;
  grantedAt: number;
  expiresAt: number;
}

export interface PlayerState {
  playerId: string;
  currentStreak: number;
  dailyMatchCount: number;
  dailyWinCount: number;
  windowedMatches: Array<{
    matchId: string;
    category: string;
    result: string;
    timestamp: number;
  }>;
  activeMultipliers: ActiveMultiplier[];
  inventory: {
    coins: number;
    lootBoxes: number;
  };
  lastUpdated: number;
}

export interface LedgerEntry {
  id: string;
  playerId: string;
  ruleId: string;
  ruleName: string;
  reward: RewardConfig;
  idempotencyKey: string;
  grantedAt: number;
  status: 'GRANTED' | 'DEDUPED';
}
