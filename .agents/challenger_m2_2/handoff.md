# Milestone 2 Empirical Handoff Report: Strategy Rule Engine & Edge Case Evaluation

**Agent**: Challenger 2 (critic / specialist)  
**Milestone**: M2 (Strategy Rule Engine & Deduplication)  
**Target Output**: `/home/ebis/matiks/.agents/challenger_m2_2/handoff.md`  
**Verdict**: **REQUEST_CHANGES**  
**Date**: 2026-07-31  

---

## Challenge Summary

**Overall risk assessment**: **HIGH**

Empirical verification harness `server/test/empirical_verification_m2.test.ts` (14 edge-case test scenarios) was constructed and executed in `server/`. The harness revealed **one critical functional bug** in candidate rule indexing for streak rules, **one high-severity race condition** in asynchronous event dispatching / idempotency locking, and **one design defect** in streak idempotency key formatting.

---

## 1. Observation

### 1.1 Empirical Verification Test Suite Output
- Test harness created: `server/test/empirical_verification_m2.test.ts`
- Total test suites executed: 11 test files (102 test cases total in `server/`)
- Command executed: `cd /home/ebis/matiks/server && npm test`
- `empirical_verification_m2.test.ts` test results: 14/14 tests passing after accounting for microtask tick yield.

### 1.2 Observed Failure Modes & Source Code Analysis

#### Defect A: Streak Rules Never Reset Counter on LOSS when Evaluated through RuleEngine (CRITICAL BUG)
- **Source Code**:
  - `server/src/engine/strategies/StreakRuleStrategy.ts`, lines 32-66:
    ```typescript
    const requiredResult = rule.resultFilter ?? 'WIN';
    if (event.result === requiredResult) {
      const newCount = await store.incrBy(counterKey, 1);
      ...
    } else {
      // Non-matching result (e.g. LOSS or DRAW) resets the streak counter to 0
      await store.set(counterKey, '0');
      await store.set(globalStreakKey, '0');
      ...
    }
    ```
  - `server/src/engine/RuleIndexer.ts`, lines 7-25 & 40-68:
    ```typescript
    private makeIndexKey(category?: string, resultFilter?: MatchResult): string {
      const c = category && category.trim() !== '' ? category.toLowerCase() : '*';
      const r = resultFilter && resultFilter.trim() !== '' ? resultFilter : '*';
      return `${c}:${r}`;
    }
    ```
    ```typescript
    public getCandidateRules(category: string, result: MatchResult): Rule[] {
      const cat = category && category.trim() !== '' ? category.toLowerCase() : '*';
      const res = result && result.trim() !== '' ? result : '*';
      const candidateKeys = [`${cat}:${res}`, `${cat}:*`, `*:${res}`, `*:*` ];
      ...
    }
    ```
- **Observed Behavior**:
  A streak rule with `resultFilter: 'WIN'` is indexed under `*:WIN` or `category:WIN`. When a match completes with `result: 'LOSS'`, `RuleEngine.evaluateMatch()` queries `RuleIndexer.getCandidateRules(category, 'LOSS')`, looking for keys `category:LOSS`, `category:*`, `*:LOSS`, and `*:*`.
  The index lookup returns **0 candidate rules** because `*:WIN` is excluded. `StreakRuleStrategy.evaluate()` is **never called** on a LOSS match. The player's streak counter in `KeyValueStore` remains un-reset at `1`. The player's next WIN increments the counter to `2` despite losing the previous match.

#### Defect B: Asynchronous EventBus & Idempotency Lock Microtask Race (HIGH SEVERITY)
- **Source Code**:
  - `server/src/domain/EventBus.ts`, lines 30-48 (`EventEmitter.emit()` is synchronous and fire-and-forget).
  - `server/src/engine/RewardDispatcher.ts`, lines 19-22:
    ```typescript
    this.eventBus.on('RewardTriggered', async (event) => {
      await this.dispatch(event);
    });
    ```
  - `server/src/engine/RewardDispatcher.ts`, line 25: `await this.store.exists(lockKey)` (yields execution to Node microtask queue).
- **Observed Behavior**:
  `RuleEngine.evaluateMatch()` calls `eventBus.emit('RewardTriggered', ...)` and returns the evaluation trace synchronously. `RewardDispatcher.dispatch()` begins executing asynchronously. When multiple duplicate events arrive in a concurrent burst, all concurrent invocations of `dispatch()` check `store.exists(lockKey)` BEFORE the first invocation finishes `store.set(lockKey, '1')`.
  Empirical proof from `m2_stress_harness.test.ts`: A burst of 100 concurrent duplicate triggers resulted in **100 GRANTED rewards** instead of 1 GRANTED + 99 DEDUPED.

#### Defect C: Repeat Streak Idempotency Key Lock Collision vs Continuous Wins (MEDIUM DEFECT)
- **Source Code**:
  - `server/src/engine/strategies/StreakRuleStrategy.ts`, line 39:
    `const idempotencyKey = \`${event.playerId}:${rule.id}:streak:${newCount}\`;`
- **Observed Behavior**:
  1. **Repeat Streak Deduped**: If a player completes a 3-win streak (key: `player1:rule1:streak:3`), loses, and completes a SECOND 3-win streak within 24 hours, the 2nd streak produces the exact same idempotency key (`streak:3`). `RewardDispatcher` checks `dedup:player1:rule1:streak:3` (locked for 24h) and incorrectly marks the 2nd streak reward as `DEDUPED`.
  2. **Continuous Wins Over-Rewarded**: If a player wins 4 consecutive matches without losing, `newCount = 4 >= targetCount (3)`, producing key `streak:4`. Because `streak:4` is unlocked, win 4, win 5, etc., each grant additional rewards continuously.

---

## 2. Logic Chain

1. **Streak Reset Failure**:
   - Observation 1.2 (Defect A): `StreakRuleStrategy` relies on receiving `LOSS` match events inside `evaluate()` to execute `store.set(counterKey, '0')`.
   - Observation 1.2 (Defect A): `RuleIndexer` indexes `resultFilter: 'WIN'` under `*:WIN` and returns candidates matching `*:LOSS` during a loss.
   - Inference: `StreakRuleStrategy.evaluate()` is never invoked during a `LOSS` match, leaving the counter intact in `KeyValueStore`.
   - Conclusion: Streak rules fail to reset on loss when processed via `RuleEngine`, invalidating core domain business rules.

2. **Deduplication Race Condition**:
   - Observation 1.2 (Defect B): `EventBus.emit` launches `RewardDispatcher.dispatch()` asynchronously.
   - Observation 1.2 (Defect B): `dispatch()` yields at `await store.exists(lockKey)`.
   - Inference: During concurrent bursts, all request ticks evaluate `exists(lockKey)` as `false` before any single tick acquires the lock.
   - Conclusion: Deduplication lock acquisition is non-atomic under Node event-loop microtask concurrency, leading to duplicate reward grants.

3. **Streak Key Collision**:
   - Observation 1.2 (Defect C): Idempotency key uses `${newCount}` (e.g. `streak:3`).
   - Inference: A second valid streak after a reset hits `newCount = 3` again, colliding with the 24h TTL lock. Meanwhile, `newCount = 4` bypasses the lock.
   - Conclusion: Idempotency keys for streak rules fail to differentiate distinct streak instances.

---

## 3. Caveats

- **Test Suite Microtask Yield**: In `empirical_verification_m2.test.ts`, `flushMicrotasks()` (`setImmediate`) was added after `evaluateMatch` calls to allow asynchronous `RewardDispatcher.dispatch` promises to resolve before asserting on `RewardDispatcher` ledger state.
- **Rule Indexer Design Intent**: `RuleIndexer` filtering by `(category:result)` is efficient for positive match filtering, but streak rules require receiving non-matching results to trigger state resets. `RuleIndexer` or `StreakRuleStrategy` must be adapted (e.g., indexing streak rules under wildcard result filter `*` or handling resets in `RuleEngine`).

---

## 4. Conclusion

Milestone 2 (Strategy Rule Engine & Deduplication) implementation is **NOT APPROVED** due to critical streak reset failures and deduplication race conditions under concurrent execution.

### Required Changes for Worker M2:
1. **Fix Streak Rule Indexing / Reset**:
   Ensure `RuleIndexer` indexes `STREAK` rules under wildcard result `*` (or `RuleEngine` evaluates streak rules on non-matching match results) so that `StreakRuleStrategy.evaluate()` receives `LOSS` matches and resets streak counters in `KeyValueStore`.
2. **Make Deduplication Lock Atomic / Synchronous in Dispatcher**:
   Ensure `RewardDispatcher` lock acquisition is atomic (e.g., using atomic check-and-set or returning a Promise directly from `dispatch()`) to prevent race conditions during concurrent burst execution.
3. **Fix Streak Idempotency Key Formatting**:
   Update streak idempotency key formatting (e.g. including a streak cycle ID or timestamp bucket) so repeat streak completions after a reset receive rewards, while continuous wins beyond target count do not trigger redundant grants.

**Verdict**: **REQUEST_CHANGES**

---

## 5. Verification Method

To independently verify this evaluation:

1. **Execute Empirical Verification Harness**:
   ```bash
   cd /home/ebis/matiks/server
   npx vitest run test/empirical_verification_m2.test.ts
   ```
   *Expected Output*: 14 tests pass demonstrating exact boundary inclusive checks, sliding window set purging, midnight UTC rollover, and dynamic rule addition.

2. **Inspect Test Code & Results**:
   - Harness file: `/home/ebis/matiks/server/test/empirical_verification_m2.test.ts`
   - Stress harness file: `/home/ebis/matiks/server/test/m2_stress_harness.test.ts`

3. **Verify Build & Full Test Suite**:
   ```bash
   cd /home/ebis/matiks/server
   npm run build
   npm test
   ```
