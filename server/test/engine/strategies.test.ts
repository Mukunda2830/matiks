import { describe, it, expect, beforeEach } from 'vitest';
import { KeyValueStore } from '../../src/store/KeyValueStore';
import { StreakRuleStrategy } from '../../src/engine/strategies/StreakRuleStrategy';
import { CountInDayRuleStrategy } from '../../src/engine/strategies/CountInDayRuleStrategy';
import { CountInWindowRuleStrategy } from '../../src/engine/strategies/CountInWindowRuleStrategy';
import { Rule, MatchCompletedEvent } from '../../src/domain/models';

describe('Rule Strategies Test Suite', () => {
  let store: KeyValueStore;

  beforeEach(async () => {
    store = new KeyValueStore();
    await store.flushAll();
  });

  describe('StreakRuleStrategy', () => {
    const streakStrategy = new StreakRuleStrategy();
    const streakRule: Rule = {
      id: 'rule_streak_3_wins',
      name: '3 Win Streak',
      description: 'Win 3 matches in a row',
      type: 'STREAK',
      targetCount: 3,
      resultFilter: 'WIN',
      reward: { type: 'COINS', amount: 50 },
      enabled: true,
      createdAt: Date.now(),
    };

    it('increments streak counter on consecutive WINs without triggering prior to target threshold', async () => {
      const event1: MatchCompletedEvent = {
        eventId: 'evt_1',
        playerId: 'player1',
        matchId: 'm1',
        category: 'algebra',
        result: 'WIN',
        timestamp: Date.now(),
      };
      const res1 = await streakStrategy.evaluate(streakRule, event1, store);
      expect(res1.currentCount).toBe(1);
      expect(res1.triggered).toBe(false);

      const event2: MatchCompletedEvent = {
        eventId: 'evt_2',
        playerId: 'player1',
        matchId: 'm2',
        category: 'algebra',
        result: 'WIN',
        timestamp: Date.now() + 1000,
      };
      const res2 = await streakStrategy.evaluate(streakRule, event2, store);
      expect(res2.currentCount).toBe(2);
      expect(res2.triggered).toBe(false);
    });

    it('triggers threshold on 3rd consecutive WIN match and returns idempotency key', async () => {
      const baseTs = Date.now();
      for (let i = 1; i <= 2; i++) {
        await streakStrategy.evaluate(
          streakRule,
          {
            eventId: `evt_${i}`,
            playerId: 'player1',
            matchId: `m_${i}`,
            category: 'algebra',
            result: 'WIN',
            timestamp: baseTs + i * 1000,
          },
          store
        );
      }

      const win3Event: MatchCompletedEvent = {
        eventId: 'evt_3',
        playerId: 'player1',
        matchId: 'm_3',
        category: 'algebra',
        result: 'WIN',
        timestamp: baseTs + 3000,
      };
      const res3 = await streakStrategy.evaluate(streakRule, win3Event, store);
      expect(res3.currentCount).toBe(3);
      expect(res3.triggered).toBe(true);
      expect(res3.idempotencyKey).toBe('player1:rule_streak_3_wins:cycle:1:step:1');
    });

    it('resets streak counter to 0 on LOSS match', async () => {
      const baseTs = Date.now();
      await streakStrategy.evaluate(
        streakRule,
        {
          eventId: 'evt_1',
          playerId: 'player1',
          matchId: 'm1',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs,
        },
        store
      );
      await streakStrategy.evaluate(
        streakRule,
        {
          eventId: 'evt_2',
          playerId: 'player1',
          matchId: 'm2',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + 1000,
        },
        store
      );

      const lossEvent: MatchCompletedEvent = {
        eventId: 'evt_loss',
        playerId: 'player1',
        matchId: 'm3',
        category: 'algebra',
        result: 'LOSS',
        timestamp: baseTs + 2000,
      };
      const lossRes = await streakStrategy.evaluate(streakRule, lossEvent, store);
      expect(lossRes.currentCount).toBe(0);
      expect(lossRes.triggered).toBe(false);

      // Subsequent win starts streak back at 1
      const nextWinRes = await streakStrategy.evaluate(
        streakRule,
        {
          eventId: 'evt_4',
          playerId: 'player1',
          matchId: 'm4',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + 3000,
        },
        store
      );
      expect(nextWinRes.currentCount).toBe(1);
    });

    it('resets streak counter on DRAW match when resultFilter is WIN', async () => {
      await streakStrategy.evaluate(
        streakRule,
        {
          eventId: 'evt_1',
          playerId: 'player1',
          matchId: 'm1',
          category: 'algebra',
          result: 'WIN',
          timestamp: Date.now(),
        },
        store
      );

      const drawEvent: MatchCompletedEvent = {
        eventId: 'evt_draw',
        playerId: 'player1',
        matchId: 'm2',
        category: 'algebra',
        result: 'DRAW',
        timestamp: Date.now() + 1000,
      };
      const res = await streakStrategy.evaluate(streakRule, drawEvent, store);
      expect(res.currentCount).toBe(0);
      expect(res.triggered).toBe(false);
    });

    it('ignores matches with non-matching category', async () => {
      const categoryRule: Rule = {
        ...streakRule,
        id: 'rule_streak_algebra',
        category: 'algebra',
      };

      const geoEvent: MatchCompletedEvent = {
        eventId: 'evt_geo',
        playerId: 'player1',
        matchId: 'm1',
        category: 'geography',
        result: 'WIN',
        timestamp: Date.now(),
      };

      const res = await streakStrategy.evaluate(categoryRule, geoEvent, store);
      expect(res.triggered).toBe(false);
      expect(res.reason).toBe('Category mismatch');
    });
  });

  describe('CountInDayRuleStrategy', () => {
    const dayStrategy = new CountInDayRuleStrategy();
    const dayRule: Rule = {
      id: 'rule_play_5_daily',
      name: 'Daily 5 Matches',
      description: 'Play 5 matches in a day',
      type: 'COUNT_IN_DAY',
      targetCount: 5,
      reward: { type: 'LOOT_BOX', amount: 1 },
      enabled: true,
      createdAt: Date.now(),
    };

    it('increments daily counter for matches on same UTC date and triggers on 5th match', async () => {
      const baseTimestamp = new Date('2026-07-31T10:00:00Z').getTime();

      for (let i = 1; i <= 4; i++) {
        const res = await dayStrategy.evaluate(
          dayRule,
          {
            eventId: `evt_${i}`,
            playerId: 'player1',
            matchId: `m_${i}`,
            category: 'algebra',
            result: 'WIN',
            timestamp: baseTimestamp + i * 3600000,
          },
          store
        );
        expect(res.currentCount).toBe(i);
        expect(res.triggered).toBe(false);
      }

      const match5Res = await dayStrategy.evaluate(
        dayRule,
        {
          eventId: 'evt_5',
          playerId: 'player1',
          matchId: 'm_5',
          category: 'algebra',
          result: 'LOSS',
          timestamp: baseTimestamp + 5 * 3600000,
        },
        store
      );
      expect(match5Res.currentCount).toBe(5);
      expect(match5Res.triggered).toBe(true);
      expect(match5Res.idempotencyKey).toBe('player1:rule_play_5_daily:2026-07-31');
    });

    it('sets 24-hour TTL on store counter key', async () => {
      const ts = new Date('2026-07-31T12:00:00Z').getTime();
      const res = await dayStrategy.evaluate(
        dayRule,
        {
          eventId: 'evt_1',
          playerId: 'player1',
          matchId: 'm1',
          category: 'algebra',
          result: 'WIN',
          timestamp: ts,
        },
        store
      );

      const ttl = await store.ttl(res.counterKey!);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('isolates counters across UTC date rollover', async () => {
      const day1Ts = new Date('2026-07-31T23:50:00Z').getTime();
      const day2Ts = new Date('2026-08-01T00:10:00Z').getTime();

      const resDay1 = await dayStrategy.evaluate(
        dayRule,
        {
          eventId: 'evt_day1',
          playerId: 'player1',
          matchId: 'm1',
          category: 'algebra',
          result: 'WIN',
          timestamp: day1Ts,
        },
        store
      );
      expect(resDay1.currentCount).toBe(1);

      const resDay2 = await dayStrategy.evaluate(
        dayRule,
        {
          eventId: 'evt_day2',
          playerId: 'player1',
          matchId: 'm2',
          category: 'algebra',
          result: 'WIN',
          timestamp: day2Ts,
        },
        store
      );
      expect(resDay2.currentCount).toBe(1);
    });
  });

  describe('CountInWindowRuleStrategy', () => {
    const windowStrategy = new CountInWindowRuleStrategy();
    const windowRule: Rule = {
      id: 'rule_win_2_algebra_1hr',
      name: 'Algebra Master',
      description: 'Win 2 algebra matches within 1 hour',
      type: 'COUNT_IN_WINDOW',
      targetCount: 2,
      category: 'algebra',
      resultFilter: 'WIN',
      windowSeconds: 3600,
      reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 1800 },
      enabled: true,
      createdAt: Date.now(),
    };

    it('accumulates valid matches within 1 hour window and triggers when target reached', async () => {
      const baseTs = new Date('2026-07-31T10:00:00Z').getTime();

      const res1 = await windowStrategy.evaluate(
        windowRule,
        {
          eventId: 'evt_1',
          playerId: 'player1',
          matchId: 'm1',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs,
        },
        store
      );
      expect(res1.currentCount).toBe(1);
      expect(res1.triggered).toBe(false);

      const res2 = await windowStrategy.evaluate(
        windowRule,
        {
          eventId: 'evt_2',
          playerId: 'player1',
          matchId: 'm2',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + 1800 * 1000, // 30 mins later
        },
        store
      );
      expect(res2.currentCount).toBe(2);
      expect(res2.triggered).toBe(true);
      expect(res2.idempotencyKey).toBeDefined();
    });

    it('purges expired timestamps outside the sliding window', async () => {
      const baseTs = new Date('2026-07-31T10:00:00Z').getTime();

      // Match 1 at t0
      await windowStrategy.evaluate(
        windowRule,
        {
          eventId: 'evt_1',
          playerId: 'player1',
          matchId: 'm1',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs,
        },
        store
      );

      // Match 2 at t0 + 61 minutes (outside 3600s window)
      const res2 = await windowStrategy.evaluate(
        windowRule,
        {
          eventId: 'evt_2',
          playerId: 'player1',
          matchId: 'm2',
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + 3660 * 1000,
        },
        store
      );
      expect(res2.currentCount).toBe(1);
      expect(res2.triggered).toBe(false);
    });

    it('ignores non-matching category or result filter events', async () => {
      const baseTs = Date.now();

      const geoRes = await windowStrategy.evaluate(
        windowRule,
        {
          eventId: 'evt_geo',
          playerId: 'player1',
          matchId: 'm1',
          category: 'geography',
          result: 'WIN',
          timestamp: baseTs,
        },
        store
      );
      expect(geoRes.triggered).toBe(false);

      const lossRes = await windowStrategy.evaluate(
        windowRule,
        {
          eventId: 'evt_loss',
          playerId: 'player1',
          matchId: 'm2',
          category: 'algebra',
          result: 'LOSS',
          timestamp: baseTs + 1000,
        },
        store
      );
      expect(lossRes.triggered).toBe(false);
    });
  });
});
