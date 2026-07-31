import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyValueStore } from '../src/store/KeyValueStore';
import { EventBus } from '../src/domain/EventBus';
import { RuleEngine } from '../src/engine/RuleEngine';
import { RewardDispatcher } from '../src/engine/RewardDispatcher';
import { Rule, MatchCompletedEvent } from '../src/domain/models';

/**
 * Helper to yield execution tick to microtask queue so async EventBus listeners finish.
 */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('Empirical Verification Harness — Challenger M2 (Rule Evaluation & Deduplication)', () => {
  let store: KeyValueStore;
  let eventBus: EventBus;
  let ruleEngine: RuleEngine;
  let rewardDispatcher: RewardDispatcher;

  beforeEach(async () => {
    store = new KeyValueStore();
    await store.flushAll();
    eventBus = new EventBus();
    ruleEngine = new RuleEngine(store, eventBus);
    rewardDispatcher = new RewardDispatcher(store, eventBus);
  });

  afterEach(async () => {
    rewardDispatcher.clear();
    await store.flushAll();
  });

  // =========================================================================
  // EDGE CASE 1: Streak rules with alternating WIN/LOSS/WIN streams
  // =========================================================================
  describe('1. Streak Rules with Alternating WIN/LOSS/WIN Streams', () => {
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

    it('verifies FIX: RuleEngine includes StreakRule on LOSS match, successfully resetting streak counter', async () => {
      ruleEngine.registerRule(streakRule);
      const baseTs = Date.now();

      // Win 1
      await ruleEngine.evaluateMatch({
        eventId: 'm1',
        playerId: 'player_bug_streak',
        matchId: 'm1',
        category: 'algebra',
        result: 'WIN',
        timestamp: baseTs,
      });

      let streakVal = await store.get('player:player_bug_streak:streak:rule_streak_3_wins');
      expect(streakVal).toBe('1');

      // LOSS match -> RuleIndexer now indexes STREAK rules under wildcard result filter *.
      // RuleIndexer.getCandidateRules('algebra', 'LOSS') returns streakRule!
      const lossTrace = await ruleEngine.evaluateMatch({
        eventId: 'm2',
        playerId: 'player_bug_streak',
        matchId: 'm2',
        category: 'algebra',
        result: 'LOSS',
        timestamp: baseTs + 1000,
      });

      expect(lossTrace.candidateRules.length).toBe(1); // Candidate rule STREAK is returned!

      // Store counter is reset to 0 on LOSS!
      streakVal = await store.get('player:player_bug_streak:streak:rule_streak_3_wins');
      expect(streakVal).toBe('0'); // Reset to 0!

      // Win 2 (1st win after loss) increments counter to 1
      await ruleEngine.evaluateMatch({
        eventId: 'm3',
        playerId: 'player_bug_streak',
        matchId: 'm3',
        category: 'algebra',
        result: 'WIN',
        timestamp: baseTs + 2000,
      });

      streakVal = await store.get('player:player_bug_streak:streak:rule_streak_3_wins');
      expect(streakVal).toBe('1'); // 1 win after reset
    });

    it('empirically verifies repeat streak completion after loss & reset (Idempotency Key cycle behavior)', async () => {
      ruleEngine.registerRule(streakRule);
      const baseTs = Date.now();

      // Streak 1: Win 1, Win 2, Win 3 -> Triggers reward (cycle: 1, step: 1)
      for (let i = 1; i <= 3; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `s1_evt_${i}`,
          playerId: 'player_streak_repeat',
          matchId: `s1_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + i * 1000,
        });
      }
      await flushMicrotasks();

      const ledger1 = rewardDispatcher.getLedger();
      expect(ledger1.length).toBe(1);
      expect(ledger1[0].status).toBe('GRANTED');
      expect(ledger1[0].idempotencyKey).toBe('player_streak_repeat:rule_streak_3_wins:cycle:1:step:1');

      // LOSS match resets counter and increments cycle to 2
      await ruleEngine.evaluateMatch({
        eventId: 's1_loss',
        playerId: 'player_streak_repeat',
        matchId: 's1_m_loss',
        category: 'algebra',
        result: 'LOSS',
        timestamp: baseTs + 4000,
      });

      // Streak 2: Win 1, Win 2, Win 3 -> Triggers streak reward for cycle 2 (cycle: 2, step: 1)
      for (let i = 1; i <= 3; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `s2_evt_${i}`,
          playerId: 'player_streak_repeat',
          matchId: `s2_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + 5000 + i * 1000,
        });
      }
      await flushMicrotasks();

      // Empirical Observation: The 2nd streak completion produces idempotency key 'player_streak_repeat:rule_streak_3_wins:cycle:2:step:1'.
      // Because cycle key is 2, it is a fresh key and receives status GRANTED!
      const ledger2 = rewardDispatcher.getLedger();
      expect(ledger2.length).toBe(2);
      expect(ledger2[0].status).toBe('GRANTED');
      expect(ledger2[1].status).toBe('GRANTED');
      expect(ledger2[1].idempotencyKey).toBe('player_streak_repeat:rule_streak_3_wins:cycle:2:step:1');
    });

    it('empirically verifies 4th consecutive WIN without loss (deduplicates within same step milestone)', async () => {
      ruleEngine.registerRule(streakRule);
      const baseTs = Date.now();

      // Win 1, Win 2, Win 3, Win 4
      for (let i = 1; i <= 4; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `c_evt_${i}`,
          playerId: 'player_streak_4win',
          matchId: `c_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: baseTs + i * 1000,
        });
      }
      await flushMicrotasks();

      // Win 3 produces key 'player_streak_4win:rule_streak_3_wins:cycle:1:step:1' -> GRANTED
      // Win 4 produces key 'player_streak_4win:rule_streak_3_wins:cycle:1:step:1' -> DEDUPED (same step milestone)
      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(2);
      expect(ledger[0].status).toBe('GRANTED');
      expect(ledger[0].idempotencyKey).toBe('player_streak_4win:rule_streak_3_wins:cycle:1:step:1');
      expect(ledger[1].status).toBe('DEDUPED');
      expect(ledger[1].idempotencyKey).toBe('player_streak_4win:rule_streak_3_wins:cycle:1:step:1');

      const state = await rewardDispatcher.getPlayerState('player_streak_4win');
      expect(state.inventory.coins).toBe(50);
    });
  });

  // =========================================================================
  // EDGE CASE 2: Count-In-Window sliding window expiration across exact time boundaries
  // =========================================================================
  describe('2. Count-In-Window Expiration Across Exact Time Boundaries', () => {
    const windowRule: Rule = {
      id: 'rule_win_2_algebra_1hr',
      name: 'Algebra Master',
      description: 'Win 2 algebra matches within 1 hour',
      type: 'COUNT_IN_WINDOW',
      targetCount: 2,
      category: 'algebra',
      resultFilter: 'WIN',
      windowSeconds: 3600, // 3600 seconds = 3,600,000 ms
      reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 1800 },
      enabled: true,
      createdAt: Date.now(),
    };

    it('evaluates exact boundary inclusive check: match at T0 and match at T0 + 3600000ms (exact 1 hour) TRIGGERS', async () => {
      ruleEngine.registerRule(windowRule);
      const T0 = 1_700_000_000_000;
      const exactBoundaryTs = T0 + 3600 * 1000; // T0 + 3,600,000 ms

      // Match 1 at T0
      const res1 = await ruleEngine.evaluateMatch({
        eventId: 'win_evt_1',
        playerId: 'player_window_boundary',
        matchId: 'wm_1',
        category: 'algebra',
        result: 'WIN',
        timestamp: T0,
      });
      expect(res1.evaluations[0].currentCount).toBe(1);
      expect(res1.evaluations[0].triggered).toBe(false);

      // Match 2 at T0 + 3600000 ms (cutoff = T0 + 3600000 - 3600000 = T0. Comparison: T0 >= T0 -> TRUE)
      const res2 = await ruleEngine.evaluateMatch({
        eventId: 'win_evt_2',
        playerId: 'player_window_boundary',
        matchId: 'wm_2',
        category: 'algebra',
        result: 'WIN',
        timestamp: exactBoundaryTs,
      });
      expect(res2.evaluations[0].currentCount).toBe(2);
      expect(res2.evaluations[0].triggered).toBe(true);
      await flushMicrotasks();

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(1);
      expect(ledger[0].status).toBe('GRANTED');
    });

    it('evaluates 1ms past window boundary: match at T0 and match at T0 + 3600001ms PURGES match at T0 and DOES NOT trigger', async () => {
      ruleEngine.registerRule(windowRule);
      const T0 = 1_700_000_000_000;
      const pastBoundaryTs = T0 + 3600 * 1000 + 1; // T0 + 3,600,001 ms (1ms past 1 hour)

      // Match 1 at T0
      await ruleEngine.evaluateMatch({
        eventId: 'win_evt_1',
        playerId: 'player_window_expired',
        matchId: 'wm_1',
        category: 'algebra',
        result: 'WIN',
        timestamp: T0,
      });

      // Match 2 at T0 + 3,600,001 ms (cutoff = T0 + 1ms. Comparison: T0 >= T0 + 1ms -> FALSE. Match 1 purged!)
      const res2 = await ruleEngine.evaluateMatch({
        eventId: 'win_evt_2',
        playerId: 'player_window_expired',
        matchId: 'wm_2',
        category: 'algebra',
        result: 'WIN',
        timestamp: pastBoundaryTs,
      });

      expect(res2.evaluations[0].currentCount).toBe(1);
      expect(res2.evaluations[0].triggered).toBe(false);
      await flushMicrotasks();

      // Verify KeyValueStore set members only contain Match 2
      const setMembers = await store.sMembers('player:player_window_expired:window:rule_win_2_algebra_1hr');
      expect(setMembers.length).toBe(1);
      expect(setMembers[0]).toContain('wm_2');

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(0);
    });

    it('evaluates sliding window member accumulation and partial expired member purging', async () => {
      ruleEngine.registerRule(windowRule);
      const T0 = 1_700_000_000_000;

      // Match 1 at T0
      await ruleEngine.evaluateMatch({ eventId: 'e1', playerId: 'p_slide', matchId: 'm1', category: 'algebra', result: 'WIN', timestamp: T0 });
      // Match 2 at T0 + 1000s
      await ruleEngine.evaluateMatch({ eventId: 'e2', playerId: 'p_slide', matchId: 'm2', category: 'algebra', result: 'WIN', timestamp: T0 + 1000 * 1000 });
      // Match 3 at T0 + 2000s
      await ruleEngine.evaluateMatch({ eventId: 'e3', playerId: 'p_slide', matchId: 'm3', category: 'algebra', result: 'WIN', timestamp: T0 + 2000 * 1000 });

      const setKey = 'player:p_slide:window:rule_win_2_algebra_1hr';
      let members = await store.sMembers(setKey);
      expect(members.length).toBe(3);

      // Match 4 at T0 + 3610s (3,610,000 ms).
      // Cutoff = T0 + 10s. Match 1 (T0) is expired (< T0 + 10s). Matches 2 (T0+1000s) and 3 (T0+2000s) remain valid!
      const res4 = await ruleEngine.evaluateMatch({
        eventId: 'e4',
        playerId: 'p_slide',
        matchId: 'm4',
        category: 'algebra',
        result: 'WIN',
        timestamp: T0 + 3610 * 1000,
      });

      // Valid members are M2, M3, plus current M4 -> activeCount = 3
      expect(res4.evaluations[0].currentCount).toBe(3);
      expect(res4.evaluations[0].triggered).toBe(true);

      members = await store.sMembers(setKey);
      expect(members.length).toBe(3); // M1 was purged from store!
      const memberStrs = members.join(' ');
      expect(memberStrs).not.toContain('m1');
      expect(memberStrs).toContain('m2');
      expect(memberStrs).toContain('m3');
      expect(memberStrs).toContain('m4');
    });

    it('empirically tests time bucket idempotency key generation across window boundaries', async () => {
      ruleEngine.registerRule(windowRule);
      // Window is 3600s = 3600000ms.
      // Time bucket = Math.floor(timestamp / 3600000)
      const tsBucket0 = 3599 * 1000; // 3,599,000 ms -> bucket 0
      const tsBucket1 = 3601 * 1000; // 3,601,000 ms -> bucket 1

      // Trigger 1 in bucket 0 (Match 1 + Match 2)
      await ruleEngine.evaluateMatch({ eventId: 'b0_1', playerId: 'p_bucket', matchId: 'm_b0_1', category: 'algebra', result: 'WIN', timestamp: tsBucket0 - 1000 });
      const res1 = await ruleEngine.evaluateMatch({ eventId: 'b0_2', playerId: 'p_bucket', matchId: 'm_b0_2', category: 'algebra', result: 'WIN', timestamp: tsBucket0 });
      expect(res1.evaluations[0].idempotencyKey).toBe('p_bucket:rule_win_2_algebra_1hr:0');
      await flushMicrotasks();

      // Trigger 2 in bucket 1 (Match 3 in bucket 1)
      const res2 = await ruleEngine.evaluateMatch({ eventId: 'b1_1', playerId: 'p_bucket', matchId: 'm_b1_1', category: 'algebra', result: 'WIN', timestamp: tsBucket1 });
      expect(res2.evaluations[0].idempotencyKey).toBe('p_bucket:rule_win_2_algebra_1hr:1');
      await flushMicrotasks();

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(2); // 2 GRANTED rewards across different time buckets
      expect(ledger[0].status).toBe('GRANTED');
      expect(ledger[1].status).toBe('GRANTED');
    });
  });

  // =========================================================================
  // EDGE CASE 3: Count-In-Day midnight UTC rollover
  // =========================================================================
  describe('3. Count-In-Day Midnight UTC Rollover', () => {
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

    it('correctly isolates daily match counters across exact midnight UTC boundary (23:59:59.999Z vs 00:00:00.000Z)', async () => {
      ruleEngine.registerRule(dayRule);

      // Day 1: 2026-07-31T23:59:59.999Z (Timestamp: 1785542399999)
      const day1LastMs = new Date('2026-07-31T23:59:59.999Z').getTime();
      // Day 2: 2026-08-01T00:00:00.000Z (Timestamp: 1785542400000)
      const day2FirstMs = new Date('2026-08-01T00:00:00.000Z').getTime();

      // Play 4 matches on Day 1
      for (let i = 1; i <= 4; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `d1_evt_${i}`,
          playerId: 'player_utc',
          matchId: `d1_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: day1LastMs - (5 - i) * 1000,
        });
      }

      // 5th match on Day 1 at 23:59:59.999Z
      const resDay1Match5 = await ruleEngine.evaluateMatch({
        eventId: 'd1_evt_5',
        playerId: 'player_utc',
        matchId: 'd1_m_5',
        category: 'algebra',
        result: 'WIN',
        timestamp: day1LastMs,
      });

      expect(resDay1Match5.evaluations[0].currentCount).toBe(5);
      expect(resDay1Match5.evaluations[0].triggered).toBe(true);
      expect(resDay1Match5.evaluations[0].idempotencyKey).toBe('player_utc:rule_play_5_daily:2026-07-31');

      // 6th overall match (1st match on Day 2 at 00:00:00.000Z)
      const resDay2Match1 = await ruleEngine.evaluateMatch({
        eventId: 'd2_evt_1',
        playerId: 'player_utc',
        matchId: 'd2_m_1',
        category: 'algebra',
        result: 'WIN',
        timestamp: day2FirstMs,
      });

      expect(resDay2Match1.evaluations[0].currentCount).toBe(1); // Reset to 1 for 2026-08-01!
      expect(resDay2Match1.evaluations[0].triggered).toBe(false);
      expect(resDay2Match1.evaluations[0].idempotencyKey).toBe('player_utc:rule_play_5_daily:2026-08-01');

      // Verify separate store keys exist with correct counts
      const day1StoreCount = await store.get('player:player_utc:daily:rule_play_5_daily:2026-07-31');
      const day2StoreCount = await store.get('player:player_utc:daily:rule_play_5_daily:2026-08-01');
      expect(day1StoreCount).toBe('5');
      expect(day2StoreCount).toBe('1');
    });

    it('grants rewards on consecutive days when daily threshold is reached each day', async () => {
      ruleEngine.registerRule(dayRule);
      const day1Base = new Date('2026-07-31T10:00:00Z').getTime();
      const day2Base = new Date('2026-08-01T10:00:00Z').getTime();

      // Day 1: 5 matches -> GRANTED
      for (let i = 1; i <= 5; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `day1_evt_${i}`,
          playerId: 'player_consec_days',
          matchId: `d1_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: day1Base + i * 1000,
        });
      }
      await flushMicrotasks();

      // Day 2: 5 matches -> GRANTED (different date in idempotency key)
      for (let i = 1; i <= 5; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `day2_evt_${i}`,
          playerId: 'player_consec_days',
          matchId: `d2_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: day2Base + i * 1000,
        });
      }
      await flushMicrotasks();

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(2);
      expect(ledger[0].status).toBe('GRANTED');
      expect(ledger[0].idempotencyKey).toBe('player_consec_days:rule_play_5_daily:2026-07-31');
      expect(ledger[1].status).toBe('GRANTED');
      expect(ledger[1].idempotencyKey).toBe('player_consec_days:rule_play_5_daily:2026-08-01');

      const state = await rewardDispatcher.getPlayerState('player_consec_days');
      expect(state.inventory.lootBoxes).toBe(2);
    });

    it('deduplicates excess match triggers on the same UTC day once threshold reward is claimed', async () => {
      ruleEngine.registerRule(dayRule);
      const day1Base = new Date('2026-07-31T12:00:00Z').getTime();

      // Play 6 matches on Day 1
      for (let i = 1; i <= 6; i++) {
        await ruleEngine.evaluateMatch({
          eventId: `excess_evt_${i}`,
          playerId: 'player_excess',
          matchId: `ex_m_${i}`,
          category: 'algebra',
          result: 'WIN',
          timestamp: day1Base + i * 1000,
        });
      }
      await flushMicrotasks();

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(2);
      expect(ledger[0].status).toBe('GRANTED');
      expect(ledger[0].idempotencyKey).toBe('player_excess:rule_play_5_daily:2026-07-31');
      expect(ledger[1].status).toBe('DEDUPED'); // 6th match triggers with same date key -> DEDUPED!
      expect(ledger[1].idempotencyKey).toBe('player_excess:rule_play_5_daily:2026-07-31');

      const state = await rewardDispatcher.getPlayerState('player_excess');
      expect(state.inventory.lootBoxes).toBe(1);
    });

    it('verifies 24-hour TTL (86400s) on daily counter store key', async () => {
      ruleEngine.registerRule(dayRule);
      const ts = new Date('2026-07-31T15:00:00Z').getTime();

      await ruleEngine.evaluateMatch({
        eventId: 'ttl_evt',
        playerId: 'player_ttl',
        matchId: 'ttl_m',
        category: 'algebra',
        result: 'WIN',
        timestamp: ts,
      });

      const ttl = await store.ttl('player:player_ttl:daily:rule_play_5_daily:2026-07-31');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
    });
  });

  // =========================================================================
  // EDGE CASE 4: Dynamic rule addition + immediate evaluation without server restart
  // =========================================================================
  describe('4. Dynamic Rule Addition + Immediate Evaluation Without Server Restart', () => {
    it('dynamically registers a new rule and immediately evaluates candidate matches without server restart', async () => {
      const matchEvent1: MatchCompletedEvent = {
        eventId: 'dyn_evt_1',
        playerId: 'player_dyn',
        matchId: 'dyn_m1',
        category: 'geometry',
        result: 'WIN',
        timestamp: Date.now(),
      };

      // 1. Initial evaluation prior to registering rule -> 0 candidate rules
      const trace1 = await ruleEngine.evaluateMatch(matchEvent1);
      expect(trace1.candidateRules.length).toBe(0);
      expect(trace1.evaluations.length).toBe(0);

      // 2. Dynamically create and register new rule
      const dynamicStreakRule: Rule = {
        id: 'rule_geo_streak_2',
        name: 'Geometry 2 Win Streak',
        description: 'Win 2 geometry matches in a row',
        type: 'STREAK',
        targetCount: 2,
        category: 'geometry',
        resultFilter: 'WIN',
        reward: { type: 'COINS', amount: 100 },
        enabled: true,
        createdAt: Date.now(),
      };

      ruleEngine.registerRule(dynamicStreakRule);

      // 3. Immediately evaluate 1st match -> Candidate found, currentCount = 1, triggered = false
      const trace2 = await ruleEngine.evaluateMatch(matchEvent1);
      expect(trace2.candidateRules.length).toBe(1);
      expect(trace2.candidateRules[0].id).toBe('rule_geo_streak_2');
      expect(trace2.evaluations[0].currentCount).toBe(1);
      expect(trace2.evaluations[0].triggered).toBe(false);

      // 4. Immediately evaluate 2nd match -> Triggers reward!
      const matchEvent2: MatchCompletedEvent = {
        eventId: 'dyn_evt_2',
        playerId: 'player_dyn',
        matchId: 'dyn_m2',
        category: 'geometry',
        result: 'WIN',
        timestamp: Date.now() + 1000,
      };

      const trace3 = await ruleEngine.evaluateMatch(matchEvent2);
      expect(trace3.evaluations[0].currentCount).toBe(2);
      expect(trace3.evaluations[0].triggered).toBe(true);
      await flushMicrotasks();

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(1);
      expect(ledger[0].status).toBe('GRANTED');
      expect(ledger[0].reward.amount).toBe(100);
    });

    it('dynamically registers multiple overlapping rules and evaluates candidate rules simultaneously', async () => {
      const rule1: Rule = {
        id: 'rule_multi_streak',
        name: 'Multi Streak',
        description: 'Win 2 matches',
        type: 'STREAK',
        targetCount: 2,
        category: 'science',
        resultFilter: 'WIN',
        reward: { type: 'COINS', amount: 20 },
        enabled: true,
        createdAt: Date.now(),
      };

      ruleEngine.registerRule(rule1);

      const rule2: Rule = {
        id: 'rule_multi_window',
        name: 'Multi Window',
        description: '2 science matches in 1 hr',
        type: 'COUNT_IN_WINDOW',
        targetCount: 2,
        category: 'science',
        resultFilter: 'WIN',
        windowSeconds: 3600,
        reward: { type: 'MULTIPLIER', amount: 3, durationSeconds: 600 },
        enabled: true,
        createdAt: Date.now(),
      };

      ruleEngine.registerRule(rule2);

      // Match 1
      await ruleEngine.evaluateMatch({
        eventId: 'm_evt_1',
        playerId: 'player_multi',
        matchId: 'mm1',
        category: 'science',
        result: 'WIN',
        timestamp: Date.now(),
      });

      // Match 2 -> Evaluates BOTH candidate rules in single trace!
      const trace = await ruleEngine.evaluateMatch({
        eventId: 'm_evt_2',
        playerId: 'player_multi',
        matchId: 'mm2',
        category: 'science',
        result: 'WIN',
        timestamp: Date.now() + 1000,
      });

      expect(trace.candidateRules.length).toBe(2);
      expect(trace.evaluations.length).toBe(2);
      expect(trace.evaluations[0].triggered).toBe(true);
      expect(trace.evaluations[1].triggered).toBe(true);
      await flushMicrotasks();

      const ledger = rewardDispatcher.getLedger();
      expect(ledger.length).toBe(2);
    });

    it('dynamically disables or unregisters rules and immediately removes them from evaluation pipeline', async () => {
      const tempRule: Rule = {
        id: 'rule_temp',
        name: 'Temp Rule',
        description: 'Temporary rule',
        type: 'STREAK',
        targetCount: 1,
        category: 'history',
        resultFilter: 'WIN',
        reward: { type: 'COINS', amount: 10 },
        enabled: true,
        createdAt: Date.now(),
      };

      ruleEngine.registerRule(tempRule);

      // Verify active rule candidate lookup
      let candidates = ruleEngine.getCandidateRules('history', 'WIN');
      expect(candidates.length).toBe(1);

      // Disable rule and update registration
      tempRule.enabled = false;
      ruleEngine.registerRule(tempRule);

      // Verify disabled rule is excluded from candidates
      candidates = ruleEngine.getCandidateRules('history', 'WIN');
      expect(candidates.length).toBe(0);

      // Re-enable rule
      tempRule.enabled = true;
      ruleEngine.registerRule(tempRule);
      expect(ruleEngine.getCandidateRules('history', 'WIN').length).toBe(1);

      // Unregister rule completely
      const unregistered = ruleEngine.unregisterRule('rule_temp');
      expect(unregistered).toBe(true);
      expect(ruleEngine.getCandidateRules('history', 'WIN').length).toBe(0);
    });
  });
});
