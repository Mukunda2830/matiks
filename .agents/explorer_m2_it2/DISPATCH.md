## 2026-07-31T05:12:00Z
You are Explorer M2 Iteration 2.
Your working directory is /home/ebis/matiks/.agents/explorer_m2_it2.
Read /home/ebis/matiks/ORIGINAL_REQUEST.md, /home/ebis/matiks/.agents/orchestrator/PROJECT.md, /home/ebis/matiks/.agents/orchestrator/handoff.md, /home/ebis/matiks/.agents/challenger_m2_2/handoff.md.

Investigate the codebase in /home/ebis/matiks/server/src/engine/:
1. Defect A: RuleIndexer.ts vs StreakRuleStrategy.ts - RuleIndexer.getCandidateRules(category, 'LOSS') excludes rules with resultFilter: 'WIN', so evaluate() is never called on LOSS to reset streak counters in KeyValueStore.
2. Defect B: RewardDispatcher.ts microtask race - dispatch() yields at await store.exists(lockKey) so concurrent burst triggers all evaluate exists as false before store.set() happens.
3. Defect C: Streak idempotency key format - `${newCount}` (e.g. streak:3) collides on repeat 3-win streaks after a reset, while continuous 4th/5th wins generate unlocked new keys.

Analyze existing code in server/src/engine/ and server/test/engine/, propose exact fix strategies for each defect, write your analysis and recommendation report to /home/ebis/matiks/.agents/explorer_m2_it2/handoff.md, and send a completion message back.
