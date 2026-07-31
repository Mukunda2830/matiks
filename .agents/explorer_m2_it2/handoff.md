# Milestone 2 Iteration 2 Explorer Analysis & Fix Recommendation Report

**Agent**: Explorer M2 Iteration 2  
**Milestone**: M2 (Strategy Rule Engine & Deduplication)  
**Target Path**: `/home/ebis/matiks/.agents/explorer_m2_it2/handoff.md`  
**Date**: 2026-07-31  

---

## Executive Summary

A comprehensive investigation of `server/src/engine/` and `server/test/engine/` was conducted to analyze the three defects identified during M2 Iteration 1 review. Exact root causes were pinpointed, and precise, non-breaking fix strategies were designed for implementation by Worker M2 Iteration 2.

---

## 1. Observation

### Defect A: RuleIndexer.ts vs StreakRuleStrategy.ts — Streak Counters Never Reset on LOSS
- **Files & Line Numbers**:
  - `server/src/engine/RuleIndexer.ts`: Lines 7-11 (`makeIndexKey`) & Lines 40-57 (`getCandidateRules`).
  - `server/src/engine/strategies/StreakRuleStrategy.ts`: Lines 32-66 (`evaluate`).
  - `server/src/engine/RuleEngine.ts`: Line 61 (`candidateRules = this.indexer.getCandidateRules(...)`).
- **Verbatim Code snippet (`RuleIndexer.ts`)**:
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

    const candidateKeys = [
      `${cat}:${res}`,
      `${cat}:*`,
      `*:${res}`,
      `*:*`,
    ];
    ...
  }
  ```
- **Direct Observation**:
  Seed streak rule `rule_streak_3_wins` has `resultFilter: 'WIN'`. `RuleIndexer` registers this rule under index key `*:WIN`.
  When a match completes with `result: 'LOSS'`, `RuleEngine.evaluateMatch()` calls `RuleIndexer.getCandidateRules(category, 'LOSS')`, querying keys `${cat}:LOSS`, `${cat}:*`, `*:LOSS`, `*:*`.
  Because `*:WIN` is excluded from the lookup result, `getCandidateRules` returns **0 candidate rules**.
  `StreakRuleStrategy.evaluate()` is **never invoked on a `LOSS` match**. The player's streak counter in `KeyValueStore` remains at `1` or `2`. On the player's subsequent win, the counter increments to `2` or `3`, granting rewards for non-consecutive wins.

---

### Defect B: RewardDispatcher.ts Microtask Race — Non-Atomic Idempotency Locking
- **Files & Line Numbers**:
  - `server/src/engine/RewardDispatcher.ts`: Lines 24-53 (`dispatch`).
  - `server/src/store/KeyValueStore.ts`: Lines 117-120 (`exists`) & Lines 97-110 (`set`).
  - `server/test/m2_stress_harness.test.ts`: Stress Test 2 (lines 127-163).
- **Verbatim Code snippet (`RewardDispatcher.ts`)**:
  ```typescript
  public async dispatch(event: RewardTriggeredEvent): Promise<DispatchResult> {
    const lockKey = `dedup:${event.idempotencyKey}`;
    const isLocked = await this.store.exists(lockKey);
    const now = Date.now();

    if (isLocked) {
      ...
    }

    // Lock deduplication key with 24-hour TTL (86400s)
    await this.store.set(lockKey, '1', 86400);
  ```
- **Direct Observation**:
  `RewardDispatcher.dispatch()` is an async method that executes `await this.store.exists(lockKey)` on line 26.
  When a concurrent burst of identical `RewardTriggeredEvent`s arrives, each call yields execution to the Node.js microtask queue at `await store.exists()`.
  Because no call has yet executed `store.set(lockKey, '1', 86400)`, `store.exists()` evaluates to `false` for **all** parallel microtasks.
  Empirical stress test result: A burst of 100 concurrent duplicate triggers resulted in **100 GRANTED rewards** (5,000 coins) instead of 1 GRANTED + 99 DEDUPED (50 coins).

---

### Defect C: Streak Idempotency Key Format Collisions & Over-Rewarding
- **Files & Line Numbers**:
  - `server/src/engine/strategies/StreakRuleStrategy.ts`: Line 39 (`idempotencyKey`).
- **Verbatim Code snippet (`StreakRuleStrategy.ts`)**:
  ```typescript
  const idempotencyKey = `${event.playerId}:${rule.id}:streak:${newCount}`;
  ```
- **Direct Observation**:
  1. **Repeat Streak Deduped**: When a player completes a 3-win streak (key: `player1:rule1:streak:3`), lock `dedup:player1:rule1:streak:3` is stored for 24h. If the player loses and then completes a SECOND 3-win streak within 24 hours, the second streak generates `streak:3` again, which hits the 24h lock and is incorrectly marked `DEDUPED`.
  2. **Continuous Wins Over-Rewarded**: If a player wins 4 consecutive matches without losing, `newCount = 4 >= targetCount (3)`. Win 4 generates key `streak:4`. Because `streak:4` is unlocked, wins 4, 5, 6, etc. each generate new unlocked keys (`streak:4`, `streak:5`) and continuously grant duplicate rewards.

---

## 2. Logic Chain

1. **Streak Reset Failure (Defect A)**:
   - *Observation 1*: `StreakRuleStrategy.evaluate()` contains the reset logic (`store.set(counterKey, '0')`) inside its `else` branch (`event.result !== requiredResult`).
   - *Observation 1*: `RuleIndexer` indexes rules with `resultFilter: 'WIN'` under `*:WIN` and does not return them when queried with `result: 'LOSS'`.
   - *Inference*: `RuleIndexer` must index `STREAK` rules under wildcard result filter `*` so `getCandidateRules(category, result)` returns `STREAK` rules for any match result (`WIN`, `LOSS`, `DRAW`).
   - *Conclusion*: Passing `rule.type` to `makeIndexKey` and mapping `STREAK` rules to result wildcard `*` ensures `StreakRuleStrategy.evaluate()` is called on `LOSS` matches, resetting counters in `KeyValueStore` without changing index query behavior for other rule types.

2. **Deduplication Race Condition (Defect B)**:
   - *Observation 1*: Separate `await store.exists()` and `await store.set()` calls leave an async gap where parallel microtasks interleave.
   - *Observation 1*: In Node.js single-threaded event loop, synchronous map mutations within a single call frame execute atomically prior to returning a Promise.
   - *Inference*: Adding an atomic `setIfNotExists(key, value, ttlSeconds)` method to `KeyValueStore` will check existence and set the lock in a single synchronous step inside the store.
   - *Conclusion*: Updating `RewardDispatcher.dispatch()` to use `await store.setIfNotExists(lockKey, '1', 86400)` guarantees that only the first microtask receives `true` (lock acquired / `GRANTED`), while all concurrent microtasks in the burst receive `false` (lock rejected / `DEDUPED`).

3. **Streak Key Collision & Over-Rewarding (Defect C)**:
   - *Observation 1*: Key format `${playerId}:${ruleId}:streak:${newCount}` depends solely on total streak count.
   - *Inference*: Distinguishing streak cycles requires tracking a cycle counter (`player:${playerId}:streakcycle:${ruleId}`) in `KeyValueStore` that increments on streak resets (`LOSS`/`DRAW`). Incorporating cycle count and streak step milestone (`Math.floor(newCount / targetCount)`) into the key format ensures distinct cycles produce unique keys, while continuous wins within the same step produce identical locked keys.
   - *Conclusion*: Formatting streak idempotency keys as `${playerId}:${ruleId}:cycle:${cycle}:step:${streakStep}` and incrementing `streakcycle` on reset completely resolves repeat streak collisions and prevents continuous win over-rewarding.

---

## 3. Caveats

- **Unit Test String Assertions**: Existing unit tests (`strategies.test.ts`, `RuleEngine.test.ts`, `RewardDispatcher.test.ts`) assert on the exact string format `'player1:rule_streak_3_wins:streak:3'`. When updating `StreakRuleStrategy.ts`, these test assertions must be updated to match `'player1:rule_streak_3_wins:cycle:1:step:1'`.
- **In-Memory Store Semantics**: `KeyValueStore` operations are synchronous in memory despite returning Promises. `setIfNotExists` will be 100% thread-safe under Node.js single-threaded event-loop execution.
- **No Side Effects on Non-Streak Rules**: `CountInDayRuleStrategy` and `CountInWindowRuleStrategy` are unaffected by the `RuleIndexer` change as their `makeIndexKey` logic remains filtered by their specified `resultFilter`.

---

## 4. Conclusion & Recommended Fix Strategies

### Action Plan for Worker M2 Iteration 2:

#### Fix Strategy 1: `RuleIndexer.ts` (Defect A)
In `server/src/engine/RuleIndexer.ts`:
1. Import `RuleType` from `../domain/models`.
2. Update `makeIndexKey` to accept optional `type?: RuleType` and map `STREAK` rules to result wildcard `'*'`:
   ```typescript
   private makeIndexKey(category?: string, resultFilter?: MatchResult, type?: RuleType): string {
     const c = category && category.trim() !== '' ? category.toLowerCase() : '*';
     const r = (type === 'STREAK' || !resultFilter || resultFilter.trim() === '') ? '*' : resultFilter;
     return `${c}:${r}`;
   }
   ```
3. Update `registerRule` and `unregisterRule` to pass `rule.type` to `makeIndexKey`.

#### Fix Strategy 2: `KeyValueStore.ts` & `RewardDispatcher.ts` (Defect B)
1. In `server/src/store/KeyValueStore.ts`, add `setIfNotExists`:
   ```typescript
   public async setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
     this.checkPassiveExpiry(key);
     const existing = this.store.get(key);
     if (existing) {
       return false; // Key already exists, lock acquisition failed
     }

     const newEntry: StringEntry = {
       type: 'string',
       value,
     };
     this.store.set(key, newEntry);
     this.setTTL(key, ttlSeconds);
     return true; // Lock acquired successfully
   }
   ```
2. In `server/src/engine/RewardDispatcher.ts`, update `dispatch()`:
   ```typescript
   public async dispatch(event: RewardTriggeredEvent): Promise<DispatchResult> {
     const lockKey = `dedup:${event.idempotencyKey}`;
     const now = Date.now();

     const acquired = await this.store.setIfNotExists(lockKey, '1', 86400);

     if (!acquired) {
       const ledgerEntry: LedgerEntry = {
         id: `led_${now}_${Math.random().toString(36).substring(2, 7)}`,
         playerId: event.playerId,
         ruleId: event.ruleId,
         ruleName: event.ruleName,
         reward: event.reward,
         idempotencyKey: event.idempotencyKey,
         grantedAt: now,
         status: 'DEDUPED',
       };
       this.ledger.push(ledgerEntry);

       this.eventBus.emit('RewardDeduped', {
         playerId: event.playerId,
         ruleId: event.ruleId,
         idempotencyKey: event.idempotencyKey,
         timestamp: now,
       });

       return { status: 'DEDUPED', ledgerEntry };
     }

     // Lock acquired! Proceed to grant reward...
   ```

#### Fix Strategy 3: `StreakRuleStrategy.ts` (Defect C)
In `server/src/engine/strategies/StreakRuleStrategy.ts`:
1. Define `cycleKey = \`player:${event.playerId}:streakcycle:${rule.id}\``.
2. On matching result (`WIN`):
   Retrieve `cycle` from `store.get(cycleKey)` (defaulting to 1).
   Calculate `streakStep = Math.floor(newCount / rule.targetCount)`.
   Set `idempotencyKey = \`${event.playerId}:${rule.id}:cycle:${cycle}:step:${streakStep}\``.
3. On non-matching result (`LOSS`/`DRAW`):
   Reset `counterKey` to `'0'`, `globalStreakKey` to `'0'`, and increment `cycleKey`:
   `await store.incrBy(cycleKey, 1);`

#### Fix Strategy 4: Test Suite Synchronization
Update test assertions in `server/test/engine/strategies.test.ts`, `RuleEngine.test.ts`, `RewardDispatcher.test.ts`, and `empirical_verification_m2.test.ts` to align with the fixed idempotency key format and reset behavior.

---

## 5. Verification Method

To independently verify the fixes:

1. **Build the Server Package**:
   ```bash
   cd /home/ebis/matiks/server
   npm run build
   ```
2. **Execute Full Unit & Empirical Test Suite**:
   ```bash
   cd /home/ebis/matiks/server
   npm test
   ```
   *Expected Outcome*: All test files (100% of test cases including stress harness and empirical verification) pass cleanly.
3. **Inspect Key Test Assertions**:
   - `m2_stress_harness.test.ts`: Verify 100 concurrent duplicate dispatches produce **1 GRANTED + 99 DEDUPED**.
   - `empirical_verification_m2.test.ts`: Verify `evaluateMatch` on `LOSS` resets streak counter in `KeyValueStore` to `0`.
