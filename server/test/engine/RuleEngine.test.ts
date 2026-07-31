import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyValueStore } from '../../src/store/KeyValueStore';
import { EventBus } from '../../src/domain/EventBus';
import { RuleEngine } from '../../src/engine/RuleEngine';
import { Rule, MatchCompletedEvent, RewardTriggeredEvent } from '../../src/domain/models';

describe('RuleEngine Test Suite', () => {
  let store: KeyValueStore;
  let eventBus: EventBus;
  let engine: RuleEngine;

  beforeEach(async () => {
    store = new KeyValueStore();
    await store.flushAll();
    eventBus = new EventBus();
    engine = new RuleEngine(store, eventBus);
  });

  const streakRule: Rule = {
    id: 'rule_streak_2',
    name: '2 Win Streak',
    description: 'Win 2 matches in a row',
    type: 'STREAK',
    targetCount: 2,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 50 },
    enabled: true,
    createdAt: Date.now(),
  };

  const dailyRule: Rule = {
    id: 'rule_play_1_daily',
    name: 'Daily Play',
    description: 'Play 1 match in a day',
    type: 'COUNT_IN_DAY',
    targetCount: 1,
    reward: { type: 'LOOT_BOX', amount: 1 },
    enabled: true,
    createdAt: Date.now(),
  };

  it('registers rules and evaluates candidate rules for a match', async () => {
    engine.registerRule(streakRule);
    engine.registerRule(dailyRule);

    const event: MatchCompletedEvent = {
      eventId: 'evt_1',
      playerId: 'player1',
      matchId: 'm1',
      category: 'algebra',
      result: 'WIN',
      timestamp: Date.now(),
    };

    const trace = await engine.evaluateMatch(event);

    expect(trace.matchEvent).toEqual(event);
    expect(trace.candidateRules).toHaveLength(2);
    expect(trace.evaluations).toHaveLength(2);
    expect(trace.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('emits RewardTriggered event on EventBus when rule threshold is met', async () => {
    engine.registerRule(streakRule);

    const triggeredEvents: RewardTriggeredEvent[] = [];
    eventBus.on('RewardTriggered', (e) => {
      triggeredEvents.push(e);
    });

    const event1: MatchCompletedEvent = {
      eventId: 'evt_1',
      playerId: 'player1',
      matchId: 'm1',
      category: 'algebra',
      result: 'WIN',
      timestamp: Date.now(),
    };
    const trace1 = await engine.evaluateMatch(event1);
    expect(trace1.triggeredRewards).toHaveLength(0);
    expect(triggeredEvents).toHaveLength(0);

    const event2: MatchCompletedEvent = {
      eventId: 'evt_2',
      playerId: 'player1',
      matchId: 'm2',
      category: 'algebra',
      result: 'WIN',
      timestamp: Date.now() + 1000,
    };
    const trace2 = await engine.evaluateMatch(event2);
    expect(trace2.triggeredRewards).toHaveLength(1);
    expect(triggeredEvents).toHaveLength(1);
    expect(triggeredEvents[0].ruleId).toBe('rule_streak_2');
    expect(triggeredEvents[0].idempotencyKey).toBe('player1:rule_streak_2:cycle:1:step:1');
  });

  it('allows dynamic addition and removal of rules at runtime', async () => {
    expect(engine.getAllRules()).toHaveLength(0);

    engine.registerRule(streakRule);
    expect(engine.getAllRules()).toHaveLength(1);

    const unregisterSuccess = engine.unregisterRule('rule_streak_2');
    expect(unregisterSuccess).toBe(true);
    expect(engine.getAllRules()).toHaveLength(0);
  });
});
