/**
 * mockData.ts
 * Helper factory functions for generating valid and edge-case MatchCompletedEvents,
 * Rules, and mock payloads for testing.
 */

import type { MatchCompletedEvent, Rule } from './TestEngineHarness.ts';

export function createMockMatchEvent(overrides: Partial<MatchCompletedEvent> = {}): MatchCompletedEvent {
  const idSuffix = Math.random().toString(36).substring(2, 7);
  return {
    eventId: `evt_${Date.now()}_${idSuffix}`,
    playerId: 'player_test_1',
    matchId: `match_${Date.now()}_${idSuffix}`,
    category: 'algebra',
    result: 'WIN',
    timestamp: Date.now(),
    metadata: { difficulty: 'medium' },
    ...overrides,
  };
}

export function createMockRule(overrides: Partial<Rule> = {}): Rule {
  const idSuffix = Math.random().toString(36).substring(2, 7);
  return {
    id: `rule_custom_${idSuffix}`,
    name: 'Custom Test Rule',
    description: 'A dynamically authored rule for unit testing',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 100 },
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  };
}
