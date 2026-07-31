# Reviewer Handoff Report — Milestone 1 (Domain Core & KeyValueStore)

## 1. Observation

1. **Test & Build Execution**:
   - Command: `cd /home/ebis/matiks/server && npm test && npm run build`
   - Test Results:
     - `test/KeyValueStore.test.ts`: 20/20 passed
     - `test/EventBus.test.ts`: 5/5 passed
     - `test/seedRules.test.ts`: 5/5 passed
     - **Total**: 30/30 tests passed in 6.28s.
   - Build Results: `tsc` executed with 0 compilation errors, generating build artifacts in `server/dist/`.

2. **File Structure Inspection**:
   - `server/src/store/KeyValueStore.ts`: 273 lines. Full Redis-like key-value store supporting passive on-read expiry, active timer expiry with `timer.unref()`, timer clearing on overwrite/del/flushAll, atomic `incrBy`, and set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`).
   - `server/src/domain/models.ts`: 85 lines. Type definitions for `MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`, `RewardConfig`, `ActiveMultiplier`, `MatchResult`, `RuleType`, `RewardType`.
   - `server/src/domain/EventBus.ts`: 73 lines. Generic wrapper class around Node `EventEmitter` bound to `EventMap` type.
   - `server/src/domain/seedRules.ts`: 53 lines. `SEED_RULES` array containing 3 seed rules (`rule_streak_3_wins`, `rule_play_5_daily`, `rule_win_2_algebra_1hr`) and `getSeedRules()` deep clone utility.
   - Unit tests: `server/test/KeyValueStore.test.ts` (191 lines), `server/test/EventBus.test.ts` (118 lines), `server/test/seedRules.test.ts` (60 lines).

3. **Integrity Violations Check**:
   - No hardcoded test outputs, facade/dummy logic, or shortcuts found. All implementations use real JS data structures (`Map`, `Set`, Node `EventEmitter`) and complete logic.

---

## 2. Logic Chain

1. **KeyValueStore Verification**:
   - **Dual Passive & Active TTL**: `checkPassiveExpiry(key)` checks `Date.now() >= entry.expiresAt` on every key lookup and deletes expired entries immediately. Active timers are created using `setTimeout` with `unref()` enabled so timers do not block Node process termination or test teardown. Overwriting keys or calling `del`/`flushAll` cancels active timer handles via `clearTimeout`.
   - **Atomic Increment (`incrBy`)**: Converts existing string values with `parseInt(val, 10)`, resets non-numeric or non-string values to 0, applies increment, preserves or updates TTL, and stores back stringified result.
   - **Set Operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`)**: Uses native JS `Set<string>`. `sRem` automatically deletes key entry when set length becomes 0. Type conflicts (e.g. string key replaced by set) cleanly replace the previous key entry.

2. **Domain Models & EventBus Verification**:
   - All domain interfaces match the specifications in `ORIGINAL_REQUEST.md` and `PROJECT.md`.
   - `EventBus` provides strong TypeScript generic mapping for event names (`MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`) to their respective payload interfaces, ensuring compile-time type safety.

3. **Seed Rules Verification**:
   - The 3 initial seed rules match exact requirements:
     1. `rule_streak_3_wins`: 3 consecutive wins -> 50 COINS
     2. `rule_play_5_daily`: 5 daily matches -> 1 LOOT_BOX
     3. `rule_win_2_algebra_1hr`: 2 algebra wins in 3600s -> 2x MULTIPLIER for 1800s
   - `getSeedRules()` produces fresh deep clones using `JSON.parse(JSON.stringify(SEED_RULES))` to prevent global definition mutation.

4. **Layout Conformance**:
   - Code layout strictly adheres to `PROJECT.md` directory layout. `.agents/` contains only metadata (no source/test code).

---

## 3. Caveats

- **Time Precision**: Active TTL background timers depend on Node.js `setTimeout` event loop scheduling. Passive expiration guarantees immediate exact-millisecond invalidation on access regardless of timer execution delay.
- **Scope Boundary**: Milestone 1 is strictly restricted to domain models, KeyValueStore, EventBus, seed rules, and unit tests. Rule evaluation strategies, candidate indexing, REST APIs, and WebSockets belong to subsequent Milestones (M2-M4).

---

## 4. Conclusion & Verdict

**Verdict**: **APPROVE**

Milestone 1 work is complete, robust, cleanly compiled, fully tested (30/30 unit tests passing), type-safe, and ready to proceed to Milestone 2 (Strategy Rule Engine & Deduplication).

---

## 5. Verification Method

To independently verify the implementation:

1. **Execute Unit Tests**:
   ```bash
   cd /home/ebis/matiks/server
   npm test
   ```
   *Expected Result*: All 30 unit tests pass across 3 test files.

2. **Execute TypeScript Compiler**:
   ```bash
   cd /home/ebis/matiks/server
   npm run build
   ```
   *Expected Result*: Exits with code 0 and emits compiled `.js` and `.d.ts` declaration files in `server/dist/`.

---

## Detailed Review Report

### 1. Correctness
- **KeyValueStore**: Passive and active TTL work synchronously and asynchronously. Overwriting keys cancels active timers. Non-numeric values in `incrBy` fall back gracefully to 0. Empty sets auto-delete key.
- **EventBus**: `on`, `once`, `off`, `emit`, `removeAllListeners` delegate to `EventEmitter` while enforcing payload types.
- **Seed Rules**: All 3 rules conform to specifications. Deep copies prevent shared mutable state bugs.

### 2. Verified Claims
- `cd server && npm test`: Verified (30/30 passed) -> **PASS**
- `cd server && npm run build`: Verified (exit code 0, dist/ generated) -> **PASS**
- Dual passive/active TTL logic: Verified in `KeyValueStore.ts:28-84` and `KeyValueStore.test.ts:48-95` -> **PASS**
- Atomic `incrBy` with TTL option: Verified in `KeyValueStore.ts:135-171` -> **PASS**
- Set operations with auto-cleanup: Verified in `KeyValueStore.ts:175-260` -> **PASS**
- Immutability of seed rules: Verified in `seedRules.ts:50-52` and `seedRules.test.ts:51-58` -> **PASS**

### 3. Coverage & Quality
- All exported functions and classes are covered by unit tests.
- Code style is clean, idiomatic TypeScript with strict mode enabled.

---

## Detailed Challenge Report (Adversarial Critic)

### 1. Stress-Test Scenarios Examined

| Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|
| Overwriting a key with active TTL using `set(key, val)` without TTL | Previous timer cancelled, key becomes persistent (no TTL) | `clearTimeout(existing.timerId)` called, `expiresAt` reset to undefined | PASS |
| Calling `incrBy` on a key containing a non-numeric string like `"foo"` | Resets value to 0, increments by amount, returns numeric string | `parseInt` returns `NaN`, `currentVal` defaults to 0, returns amount | PASS |
| Calling `incrBy` on a Set key | Clears Set key, converts key to StringEntry with incremented value | `delInternal(key)` called, key replaced with StringEntry | PASS |
| Removing last item from a set via `sRem` | Key deleted from store, timer cancelled | `entry.value.size === 0` triggers `delInternal(key)` | PASS |
| Timer execution when process is exiting | Timer does not block event loop | `timerId.unref()` called on active timers | PASS |
| Modifying rule returned by `getSeedRules()` | Global `SEED_RULES` array remains pristine | Deep copy returned via `JSON.parse(JSON.stringify())` | PASS |

### 2. Overall Risk Assessment: LOW
No critical flaws, memory leaks, or type safety issues were identified. The architecture is solid for Milestone 1.
