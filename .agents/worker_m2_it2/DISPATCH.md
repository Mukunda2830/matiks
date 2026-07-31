## 2026-07-31T05:18:42Z
You are Worker M2 Iteration 2.
Your working directory is /home/ebis/matiks/.agents/worker_m2_it2.

Read the following files before writing code:
1. /home/ebis/matiks/ORIGINAL_REQUEST.md
2. /home/ebis/matiks/.agents/orchestrator/PROJECT.md
3. /home/ebis/matiks/.agents/explorer_m2_it2/handoff.md

Your task is to implement the exact remediation fix strategies for Defects A, B, and C in Milestone 2:
1. Fix Defect A (Streak reset on LOSS):
   - In `server/src/engine/RuleIndexer.ts`, map `STREAK` rules to result wildcard `'*'` in `makeIndexKey()` so `getCandidateRules(category, result)` returns `STREAK` rules for any match result (`WIN`, `LOSS`, `DRAW`).
2. Fix Defect B (RewardDispatcher deduplication microtask race):
   - In `server/src/store/KeyValueStore.ts`, add atomic method `setIfNotExists(key, value, ttlSeconds)`.
   - In `server/src/engine/RewardDispatcher.ts`, update `dispatch()` to use `await store.setIfNotExists(lockKey, '1', 86400)` to perform atomic lock acquisition without microtask race windows.
3. Fix Defect C (Streak idempotency key format):
   - In `server/src/engine/strategies/StreakRuleStrategy.ts`, track a streak cycle counter (`player:${playerId}:streakcycle:${ruleId}`) incremented on non-matching results (`LOSS`/`DRAW`).
   - Format streak idempotency keys as `${playerId}:${ruleId}:cycle:${cycle}:step:${streakStep}` where `streakStep = Math.floor(newCount / rule.targetCount)`.
4. Update unit test assertions in `server/test/engine/`, `server/test/empirical_verification_m2.test.ts`, and `server/test/m2_stress_harness.test.ts` to match the updated idempotency key format and verify all fixes.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Run `npm run build` and `npm test` inside `server/` to verify 100% of test cases pass.
Write your completion report to `/home/ebis/matiks/.agents/worker_m2_it2/handoff.md` with build and test evidence, then send a message back.
