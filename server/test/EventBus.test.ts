import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/domain/EventBus';
import { MatchCompletedEvent, RewardTriggeredEvent } from '../src/domain/models';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should emit and receive MatchCompleted event', () => {
    let receivedPayload: MatchCompletedEvent | null = null;

    bus.on('MatchCompleted', (payload) => {
      receivedPayload = payload;
    });

    const event: MatchCompletedEvent = {
      eventId: 'evt_101',
      playerId: 'player_1',
      matchId: 'match_99',
      category: 'algebra',
      result: 'WIN',
      timestamp: Date.now(),
    };

    bus.emit('MatchCompleted', event);

    expect(receivedPayload).toEqual(event);
  });

  it('should emit and receive RewardTriggered event', () => {
    let receivedPayload: RewardTriggeredEvent | null = null;

    bus.on('RewardTriggered', (payload) => {
      receivedPayload = payload;
    });

    const event: RewardTriggeredEvent = {
      eventId: 'evt_201',
      ruleId: 'rule_streak_3_wins',
      ruleName: '3 Win Streak',
      playerId: 'player_1',
      reward: { type: 'COINS', amount: 50 },
      idempotencyKey: 'player_1:rule_streak_3_wins:123',
      triggeredAt: Date.now(),
      matchEventId: 'evt_101',
    };

    bus.emit('RewardTriggered', event);

    expect(receivedPayload).toEqual(event);
  });

  it('should handle once listener correctly', () => {
    let callCount = 0;

    bus.once('RewardDeduped', () => {
      callCount++;
    });

    bus.emit('RewardDeduped', {
      playerId: 'p1',
      ruleId: 'r1',
      idempotencyKey: 'key1',
      timestamp: Date.now(),
    });

    bus.emit('RewardDeduped', {
      playerId: 'p1',
      ruleId: 'r1',
      idempotencyKey: 'key1',
      timestamp: Date.now(),
    });

    expect(callCount).toBe(1);
  });

  it('should unregister listener with off', () => {
    let callCount = 0;
    const listener = () => {
      callCount++;
    };

    bus.on('RewardDeduped', listener);
    bus.emit('RewardDeduped', {
      playerId: 'p1',
      ruleId: 'r1',
      idempotencyKey: 'key1',
      timestamp: Date.now(),
    });
    expect(callCount).toBe(1);

    bus.off('RewardDeduped', listener);
    bus.emit('RewardDeduped', {
      playerId: 'p1',
      ruleId: 'r1',
      idempotencyKey: 'key1',
      timestamp: Date.now(),
    });
    expect(callCount).toBe(1);
  });

  it('should remove all listeners', () => {
    bus.on('MatchCompleted', () => {});
    bus.on('RewardTriggered', () => {});

    expect(bus.listenerCount('MatchCompleted')).toBe(1);
    expect(bus.listenerCount('RewardTriggered')).toBe(1);

    bus.removeAllListeners();

    expect(bus.listenerCount('MatchCompleted')).toBe(0);
    expect(bus.listenerCount('RewardTriggered')).toBe(0);
  });
});
