// Shared TypeScript types mirroring the backend domain models

export type MatchResult = 'WIN' | 'LOSS' | 'DRAW';
export type RuleType = 'STREAK' | 'COUNT_IN_DAY' | 'COUNT_IN_WINDOW';
export type RewardType = 'COINS' | 'LOOT_BOX' | 'MULTIPLIER';

export interface RewardConfig {
  type: RewardType;
  amount: number;
  durationSeconds?: number;
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

// ── WebSocket event payloads ────────────────────────────────────────────────

export interface MatchReceivedPayload {
  eventId: string;
  playerId: string;
  category: string;
  result: MatchResult;
  timestamp: number;
  burstIndex?: number;
  burstTotal?: number;
}

export interface RuleCandidatesFoundPayload {
  playerId: string;
  candidateRuleIds: string[];
  candidateRuleNames?: string[];
  count: number;
}

export interface CountersUpdatedPayload {
  playerId: string;
  evaluations: Array<{
    ruleId: string;
    ruleName: string;
    currentCount: number;
    targetCount: number;
    triggered: boolean;
    reason?: string;
  }>;
}

export interface ThresholdMetPayload {
  playerId: string;
  ruleId: string;
  ruleName: string;
  reward: RewardConfig;
  idempotencyKey: string;
  timestamp: number;
}

export interface RewardGrantedPayload {
  ledgerEntry: LedgerEntry;
  playerState: PlayerState;
}

export interface RewardDedupedPayload {
  playerId: string;
  ruleId: string;
  idempotencyKey: string;
  timestamp: number;
}

export interface MetricsPayload {
  eventsProcessed: number;
  rewardsGranted: number;
  rewardsDeduped: number;
  avgEvalTimeMs: number;
  connectedClients: number;
  timestamp: number;
}

// ── Feed log entry ──────────────────────────────────────────────────────────

export type FeedEntryLevel = 'info' | 'success' | 'warning' | 'error';

export interface FeedEntry {
  id: string;
  level: FeedEntryLevel;
  message: string;
  detail?: string;
  timestamp: number;
}

// ── Pipeline stage ──────────────────────────────────────────────────────────

export type PipelineStage =
  | 'idle'
  | 'MATCH_RECEIVED'
  | 'RULE_CANDIDATES_FOUND'
  | 'COUNTERS_UPDATED'
  | 'THRESHOLD_MET'
  | 'REWARD_GRANTED'
  | 'REWARD_DEDUPED';
