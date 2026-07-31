## 2026-07-31T00:00:00Z
You are Worker M2 Iteration 3.
Your working directory is /home/ebis/matiks/.agents/worker_m2_it3.

Read:
1. /home/ebis/matiks/ORIGINAL_REQUEST.md
2. /home/ebis/matiks/.agents/orchestrator/PROJECT.md
3. /home/ebis/matiks/.agents/reviewer_m2_2_2/handoff.md

Your task is to fix the critical candidate lookup key duplication bug and performance issue identified by Reviewer 2:
1. In `server/src/engine/RuleIndexer.ts`, update `getCandidateRules(category: string, result: MatchResult)`:
   - Deduplicate the candidate keys array before querying `this.index`:
     ```typescript
     const cat = category && category.trim() !== '' ? category.toLowerCase() : '*';
     const res = result && result.trim() !== '' ? result : '*';
     const keysToQuery = Array.from(new Set([`${cat}:${res}`, `${cat}:*`, `*:${res}`, `*:*`]));
     ```
   - Iterate over `keysToQuery` to retrieve candidate rules without duplicate lookups or returning duplicate candidate rules.
2. Run `npm run build` and `npm test` inside `server/` to verify:
   - Zero TypeScript build errors.
   - 100% pass rate across all 11 test files (102 test cases).
   - In `server/test/m2_stress_harness.test.ts`, confirm index query performance test passes (`avgQueryTimeMs < 0.05ms`).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write your completion report to /home/ebis/matiks/.agents/worker_m2_it3/handoff.md with build and test evidence, then send a message back.
