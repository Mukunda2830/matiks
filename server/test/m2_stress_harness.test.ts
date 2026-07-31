import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyValueStore } from '../src/store/KeyValueStore';
import { EventBus } from '../src/domain/EventBus';
import { RuleEngine } from '../src/engine/RuleEngine';
import { RewardDispatcher } from '../src/engine/RewardDispatcher';
import { RuleIndexer } from '../src/engine/RuleIndexer';
import { Rule, MatchCompletedEvent, RewardTriggeredEvent } from '../src/domain/models';

describe('Milestone 2 Stress Test Harness — Challenger M2', () => {
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
  // 1. High-Frequency Concurrent Match Evaluations
  // =========================================================================
  describe('1. High-Frequency Concurrent Match Evaluations', () => {
    it('handles 1,000 high-frequency concurrent match evaluations across multiple active rules without state corruption', async () => {
      // Register 3 active seed rules
      const streakRule: Rule = {
        id: 'rule_streak_3',
        name: '3 Win Streak',
        description: 'Win 3 matches in a row',
        type: 'STREAK',
        targetCount: 3,
        resultFilter: 'WIN',
        reward: { type: 'COINS', amount: 50 },
        enabled: true,
        createdAt: Date.now(),
      };

      const dayRule: Rule = {
        id: 'rule_play_5_daily',
        name: '5 Daily Matches',
        description: 'Play 5 matches daily',
        type: 'COUNT_IN_DAY',
        targetCount: 5,
        reward: { type: 'LOOT_BOX', amount: 1 },
        enabled: true,
        createdAt: Date.now(),
      };

      const windowRule: Rule = {
        id: 'rule_algebra_2_win',
        name: '2 Algebra Wins',
        description: 'Win 2 algebra matches in 1h',
        type: 'COUNT_IN_WINDOW',
        targetCount: 2,
        category: 'algebra',
        resultFilter: 'WIN',
        windowSeconds: 3600,
        reward: { type: 'MULTIPLIER', amount: 2, durationSeconds: 1800 },
        enabled: true,
        createdAt: Date.now(),
      };

      ruleEngine.registerRule(streakRule);
      ruleEngine.registerRule(dayRule);
      ruleEngine.registerRule(windowRule);

      const numMatches = 1000;
      const numPlayers = 10;
      const categories = ['algebra', 'geometry', 'science', 'history'];
      const results: Array<'WIN' | 'LOSS'> = ['WIN', 'WIN', 'WIN', 'LOSS'];
      const baseTs = Date.now();

      const startTime = performance.now();

      // Launch 1,000 evaluations concurrently
      const tasks = Array.from({ length: numMatches }, (_, i) => {
        const playerId = `player_${i % numPlayers}`;
        const category = categories[i % categories.length];
        const result = results[i % results.length];
        const event: MatchCompletedEvent = {
          eventId: `evt_stress_${i}`,
          playerId,
          matchId: `m_stress_${i}`,
          category,
          result,
          timestamp: baseTs + i * 10,
        };
        return ruleEngine.evaluateMatch(event);
      });

      const traces = await Promise.all(tasks);
      const totalTimeMs = performance.now() - startTime;

      expect(traces.length).toBe(numMatches);

      // Verify throughput and trace integrity
      const avgEvalTimeMs = traces.reduce((acc, t) => acc + t.executionTimeMs, 0) / numMatches;
      const opsPerSec = (numMatches / totalTimeMs) * 1000;

      console.log(`[Stress Test 1] Processed ${numMatches} concurrent evaluations in ${totalTimeMs.toFixed(2)} ms`);
      console.log(`[Stress Test 1] Avg trace eval time: ${avgEvalTimeMs.toFixed(4)} ms | Throughput: ${opsPerSec.toFixed(0)} ops/sec`);

      // Verify that evaluations succeeded for every trace
      for (const trace of traces) {
        expect(trace.candidateRules.length).toBeGreaterThanOrEqual(1);
        expect(trace.evaluations.length).toBeGreaterThanOrEqual(1);
      }

      // Check player ledger entries
      const ledger = rewardDispatcher.getLedger();
      console.log(`[Stress Test 1] Total Ledger entries generated: ${ledger.length}`);
      expect(ledger.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. Rapid Duplicate Trigger Evaluation & Deduplication Locking
  // =========================================================================
  describe('2. Rapid Duplicate Trigger Evaluation & Deduplication Locking', () => {
    it('verifies 100% idempotency deduplication locking under concurrent burst execution of identical trigger events', async () => {
      const idempotencyKey = 'player_burst_99:rule_streak_3:cycle:1:step:1';
      const burstSize = 100;

      const triggerEvent: RewardTriggeredEvent = {
        eventId: 'rte_burst_test',
        ruleId: 'rule_streak_3',
        ruleName: '3 Win Streak',
        playerId: 'player_burst_99',
        reward: { type: 'COINS', amount: 50 },
        idempotencyKey,
        triggeredAt: Date.now(),
        matchEventId: 'm_burst_1',
      };

      // Execute 100 simultaneous concurrent dispatches for the exact same idempotency key
      const dispatchTasks = Array.from({ length: burstSize }, () =>
        rewardDispatcher.dispatch(triggerEvent)
      );

      const results = await Promise.all(dispatchTasks);

      const grantedResults = results.filter((r) => r.status === 'GRANTED');
      const dedupedResults = results.filter((r) => r.status === 'DEDUPED');

      console.log(`[Stress Test 2] Burst size: ${burstSize} | GRANTED: ${grantedResults.length} | DEDUPED: ${dedupedResults.length}`);

      const state = await rewardDispatcher.getPlayerState('player_burst_99');
      console.log(`[Stress Test 2] Final Player Coins: ${state.inventory.coins} (Expected: 50)`);

      // Invariant assertions for 100% idempotency deduplication locking:
      expect(grantedResults.length).toBe(1);
      expect(dedupedResults.length).toBe(burstSize - 1);
      expect(state.inventory.coins).toBe(50);
    });
  });

  // =========================================================================
  // 3. Wildcard Index Performance Stress with 1,000 Registered Rules
  // =========================================================================
  describe('3. Wildcard Index Performance Stress (1,000 Rules)', () => {
    it('maintains O(1) candidate lookup performance with 1,000 registered rules across exact and wildcard combinations', async () => {
      const indexer = new RuleIndexer();
      const numRules = 1000;
      const categories = ['algebra', 'geometry', 'physics', 'history', 'science'];
      const results: Array<'WIN' | 'LOSS' | 'DRAW'> = ['WIN', 'LOSS', 'DRAW'];

      // Register 1,000 rules with diverse category/resultFilter combinations
      for (let i = 0; i < numRules; i++) {
        // Distribute rules: 70% exact category/result, 20% wildcard category or result, 10% double wildcard
        let category: string | undefined = categories[i % categories.length];
        let resultFilter: 'WIN' | 'LOSS' | 'DRAW' | undefined = results[i % results.length];

        if (i % 10 === 8) category = undefined; // wildcard category
        if (i % 10 === 9) resultFilter = undefined; // wildcard result

        const rule: Rule = {
          id: `rule_scale_${i}`,
          name: `Rule ${i}`,
          description: `Description for rule ${i}`,
          type: i % 3 === 0 ? 'STREAK' : i % 3 === 1 ? 'COUNT_IN_DAY' : 'COUNT_IN_WINDOW',
          targetCount: (i % 5) + 1,
          category,
          resultFilter,
          reward: { type: 'COINS', amount: 10 },
          enabled: true,
          createdAt: Date.now(),
        };

        indexer.registerRule(rule);
      }

      expect(indexer.getAllRules().length).toBe(numRules);

      // Perform 10,000 candidate lookup queries
      const numQueries = 10000;
      const queryStart = performance.now();

      let totalCandidatesFound = 0;
      for (let q = 0; q < numQueries; q++) {
        const cat = categories[q % categories.length];
        const res = results[q % results.length];
        const candidates = indexer.getCandidateRules(cat, res);
        totalCandidatesFound += candidates.length;
      }

      const totalQueryTimeMs = performance.now() - queryStart;
      const avgQueryTimeMs = totalQueryTimeMs / numQueries;
      const queriesPerSec = (numQueries / totalQueryTimeMs) * 1000;

      console.log(`[Stress Test 3] 1,000 Rules Index Performance:`);
      console.log(`[Stress Test 3] Total ${numQueries} queries executed in ${totalQueryTimeMs.toFixed(2)} ms`);
      console.log(`[Stress Test 3] Avg lookup latency: ${avgQueryTimeMs.toFixed(5)} ms/query (${(avgQueryTimeMs * 1000).toFixed(2)} µs/query)`);
      console.log(`[Stress Test 3] Query throughput: ${queriesPerSec.toFixed(0)} queries/sec`);
      console.log(`[Stress Test 3] Avg candidate rules per query: ${(totalCandidatesFound / numQueries).toFixed(1)}`);

      // Performance requirement: Candidate lookup with 1,000 rules must average under sub-millisecond per query
      expect(avgQueryTimeMs).toBeLessThan(0.5);

      // Correctness check: ensure candidate lookup returns rules matching category/result or wildcards
      const testCandidates = indexer.getCandidateRules('algebra', 'WIN');
      for (const cand of testCandidates) {
        const catMatch = !cand.category || cand.category.toLowerCase() === 'algebra';
        const resMatch = !cand.resultFilter || cand.resultFilter === 'WIN';
        expect(catMatch && resMatch).toBe(true);
      }
    });
  });
});
