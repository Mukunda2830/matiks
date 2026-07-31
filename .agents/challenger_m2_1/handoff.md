# Handoff Report: Milestone 2 Stress Test & Adversarial Challenge

**Agent**: Challenger 1 (critic / specialist)  
**Milestone**: Milestone 2 (Strategy Rule Engine & Deduplication)  
**Verdict**: **REQUEST_CHANGES**  
**Target Handoff Path**: `/home/ebis/matiks/.agents/challenger_m2_1/handoff.md`  
**Date**: 2026-07-31  

---

## 1. Observation

A dedicated empirical stress test suite was created and executed in `server/test/m2_stress_harness.test.ts` targeting `RuleEngine`, `RuleIndexer`, and `RewardDispatcher`.

### Command Executed
```bash
cd /home/ebis/matiks/server
npx vitest run test/m2_stress_harness.test.ts
```

### Empirical Test Results Summary

1. **High-Frequency Concurrent Match Evaluations (1,000 matches)**:
   - **Result**: **PASS**
   - **Metrics**: 1,000 concurrent match evaluations across 10 players processed in 193.17 ms (~5,177 ops/sec).
   - Average evaluation trace latency: 131.67 µs per trace. Zero unhandled promise rejections or state corruption.

2. **Rapid Duplicate Trigger Evaluation & Deduplication Locking (100 concurrent burst triggers)**:
   - **Result**: **FAIL (CRITICAL BUG FOUND)**
   - **Verbatim Error Output**:
     ```
     FAIL test/m2_stress_harness.test.ts > Milestone 2 Stress Test Harness — Challenger M2 > 2. Rapid Duplicate Trigger Evaluation & Deduplication Locking > verifies 100% idempotency deduplication locking under concurrent burst execution of identical trigger events
     AssertionError: expected 100 to be 1 // Object.is equality
     - Expected: 1
     + Received: 100

     stdout | [Stress Test 2] Burst size: 100 | GRANTED: 100 | DEDUPED: 0
     stdout | [Stress Test 2] Final Player Coins: 5000 (Expected: 50)
     ```
   - **Code Location**: `server/src/engine/RewardDispatcher.ts` lines 25–53:
     ```typescript
     25: const lockKey = `dedup:${event.idempotencyKey}`;
     26: const isLocked = await this.store.exists(lockKey);
     27: const now = Date.now();
     28: 
     29: if (isLocked) {
     30:   // ... emit RewardDeduped & return DEDUPED status
     31: }
     32: 
     33: // Lock deduplication key with 24-hour TTL (86400s)
     34: await this.store.set(lockKey, '1', 86400);
     ```

3. **Wildcard Index Performance Stress (1,000 registered rules, 10,000 queries)**:
   - **Result**: **MEASURED & VERIFIED**
   - **Metrics**: 10,000 candidate lookup queries across 1,000 registered rules completed in 656.04 ms (15,243 queries/sec).
   - Average candidate lookup latency: ~65.6 µs per query.
   - Candidate filtering correctness verified across category and resultFilter wildcards.

---

## 2. Logic Chain

1. **Non-Atomic Deduplication Check-and-Set Race**:
   - In `RewardDispatcher.ts`, `dispatch(event)` executes `await this.store.exists(lockKey)` at line 26.
   - Because `KeyValueStore.exists()` is an `async` method returning a `Promise`, awaiting `exists()` yields control back to the Node.js microtask queue.
   - Under concurrent burst execution (e.g. `Promise.all` launching 100 parallel `dispatch()` calls for identical idempotency keys), all 100 execution contexts execute line 26 in the initial event loop tick before any of them reach line 53 (`await this.store.set(lockKey, '1', 86400)`).
   - As a result, all 100 calls evaluate `isLocked === false`.
   - Every single call proceeds past line 29, calls `store.set()`, increments player inventory (granting 50 coins x 100 = 5,000 coins), appends a `GRANTED` ledger entry, and emits `RewardGranted`.
   - Result: 0% deduplication under concurrent burst execution (100 GRANTED, 0 DEDUPED), leading to duplicate reward exploitation and broken idempotency contracts.

2. **Wildcard Rule Indexing Scalability**:
   - `RuleIndexer.getCandidateRules` queries 4 candidate keys (`${cat}:${res}`, `${cat}:*`, `*:${res}`, `*:*`) in O(1) map operations.
   - Benchmarking 1,000 registered rules with 10,000 queries demonstrated 15,243 queries/sec with average lookup latency of 65.6 µs.
   - The candidate lookup mechanism scales efficiently for large rule sets without linear scanning degradation.

---

## 3. Caveats

- **Scope Limit**: The stress harness evaluated single-instance Node.js in-memory operations. Distributed Redis cluster network round-trips were out of scope for Milestone 2.
- **Implementation Constraint**: As Challenger, code modification of `server/src/engine/RewardDispatcher.ts` was restricted. The defect must be fixed by worker implementation.

---

## 4. Conclusion

Verdict: **REQUEST_CHANGES**

Milestone 2 cannot be approved in its current state due to a **Critical Defect in Deduplication Atomicity**:
- Concurrent burst execution of identical reward events completely bypasses the 24-hour idempotency lock in `RewardDispatcher.ts`, causing duplicate rewards to be granted multiple times (100 GRANTED, 0 DEDUPED).

### Actionable Remediation Required:
1. **Implement Atomic Lock Acquisition in `KeyValueStore` / `RewardDispatcher`**:
   - Option A: Add a `setNX` (Set if Not Exists) or atomic lock acquisition method to `KeyValueStore` (e.g., `setNX(key, value, ttlSeconds)`), and use `const acquired = await this.store.setNX(lockKey, '1', 86400)` in `RewardDispatcher.ts`.
   - Option B: Maintain an active in-memory set / map of locked idempotency keys synchronously during dispatcher execution before entering async boundaries.

---

## 5. Verification Method

To reproduce and verify the failure:

```bash
cd /home/ebis/matiks/server
npx vitest run test/m2_stress_harness.test.ts
```

- **Pass Condition**: `GRANTED` count === 1, `DEDUPED` count === 99, Player inventory coins === 50.
- **Fail Condition (Current)**: `GRANTED` count === 100, `DEDUPED` count === 0, Player inventory coins === 5000.
