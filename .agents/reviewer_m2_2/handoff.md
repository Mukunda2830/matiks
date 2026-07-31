# Milestone 2 Review & Adversarial Challenge Report

**Reviewer**: Reviewer 2 (Adversarial Critic & Quality Reviewer)  
**Milestone**: M2 (Strategy Rule Engine & Deduplication)  
**Target Path**: `/home/ebis/matiks/.agents/reviewer_m2_2/handoff.md`  
**Verdict**: **APPROVE**  

---

## 1. Observation

All source files in `server/src/engine/` and test suites in `server/test/engine/` were independently inspected and verified:

### File Inventory & Inspection
1. `server/src/engine/strategies/RuleStrategy.ts` (Lines 1–25): Defines `StrategyEvaluationResult` interface and `RuleStrategy` contract.
2. `server/src/engine/strategies/StreakRuleStrategy.ts` (Lines 1–69): Implements streak tracking (`player:${playerId}:streak:${ruleId}`). Increments on matching `resultFilter` (defaults to `WIN`), resets counter to 0 on `LOSS` or `DRAW`, ignores category mismatches, and outputs idempotency key `${playerId}:${ruleId}:streak:${newCount}`.
3. `server/src/engine/strategies/CountInDayRuleStrategy.ts` (Lines 1–61): Implements UTC daily match tracking (`player:${playerId}:daily:${ruleId}:${dateStr}`). Uses ISO date formatting (`new Date(event.timestamp).toISOString().split('T')[0]`), applies 86,400s (24h) TTL to store keys, and outputs idempotency key `${playerId}:${ruleId}:${dateStr}`.
4. `server/src/engine/strategies/CountInWindowRuleStrategy.ts` (Lines 1–105): Implements sliding window match tracking (`player:${playerId}:window:${ruleId}`). Prunes expired timestamp members (`ts < event.timestamp - windowSeconds * 1000`), adds current match member, and outputs time-bucket idempotency key `${playerId}:${ruleId}:${timeBucket}` (`Math.floor(timestamp / windowMs)`).
5. `server/src/engine/RuleIndexer.ts` (Lines 1–83): Implements composite hash index (`category:resultFilter`) supporting wildcards (`*`). `getCandidateRules(category, result)` queries 4 candidate keys (`${cat}:${res}`, `${cat}:*`, `*:${res}`, `*:*`) in O(1) time and filters disabled rules (`enabled === false`).
6. `server/src/engine/RuleEngine.ts` (Lines 1–103): Candidate retrieval via `RuleIndexer`, strategy delegation, evaluation trace construction, and `RewardTriggered` event emission.
7. `server/src/engine/RewardDispatcher.ts` (Lines 1–154): Listens to `RewardTriggered`, checks/sets 24h deduplication lock `dedup:${idempotencyKey}`, grants rewards (COINS, LOOT_BOX, MULTIPLIER), updates `PlayerState`, appends `LedgerEntry` (`GRANTED` or `DEDUPED`), and emits `RewardGranted` / `RewardDeduped` events.

### Automated Test & Build Execution
Executed in `/home/ebis/matiks/server`:
```bash
npm test && npm run build
```
**Verbatim Output**:
```
 Test Files  9 passed (9)
      Tests  85 passed (85)
   Start at  05:07:58
   Duration  6.14s

npm notice run matiks-server@1.0.0 build
npm notice run tsc
```
- Exit Code: `0`
- Zero TypeScript errors, zero unit test failures.

---

## 2. Logic Chain

### Integrity & Anti-Cheating Audit
- **Hardcoded results check**: Passed. Strategies, indexer, engine, and dispatcher dynamically process input parameters and update `KeyValueStore` / `PlayerState`.
- **Facade implementation check**: Passed. Real set operations (`sMembers`, `sRem`, `sAdd`), string key operations (`incrBy`, `set`, `get`), and wildcard lookup maps are fully implemented.
- **Shortcuts / tool delegation check**: Passed. Code built from scratch within target directories according to domain specifications.
- **Verification integrity**: Verified independently via direct command execution.

### Detailed Edge Case & Robustness Analysis

1. **Streak Behavior on DRAW vs LOSS (`StreakRuleStrategy.ts`: lines 34–66)**:
   - For a `WIN` streak rule (`resultFilter = 'WIN'`), both `LOSS` and `DRAW` evaluate `event.result === requiredResult` as `false`.
   - Both reset counter to `'0'` for rule counter (`player:${playerId}:streak:${ruleId}`) and global streak (`player:${playerId}:streak`).
   - If a match belongs to a different category than a category-filtered streak rule, the mismatch branch executes (lines 17–29) without resetting the streak, preserving progress for category-specific streaks.

2. **Daily Date Formatting & UTC Rollover (`CountInDayRuleStrategy.ts`: line 37 & `RewardDispatcher.ts`: line 137)**:
   - `new Date(event.timestamp).toISOString().split('T')[0]` formats epoch timestamps into ISO date strings (`YYYY-MM-DD`).
   - Counter keys and idempotency keys incorporate `dateStr`, cleanly isolating daily counts across UTC date boundaries and setting 24h TTL on store keys.

3. **Idempotency Key Generation Across Strategies**:
   - `STREAK`: `${playerId}:${ruleId}:streak:${newCount}` — Ensures threshold N for rule X can only be claimed once per streak level within the 24h deduplication lock window.
   - `COUNT_IN_DAY`: `${playerId}:${ruleId}:${dateStr}` — Restricts daily milestone grants to exactly 1 per player per rule per UTC day.
   - `COUNT_IN_WINDOW`: `${playerId}:${ruleId}:${timeBucket}` — Groups sliding window triggers into deterministic time buckets, preventing duplicate grants within the same bucket.

4. **Active Multiplier Expiration (`RewardDispatcher.ts`: lines 76–85 & 144)**:
   - `MULTIPLIER` rewards record `grantedAt: now` and `expiresAt: now + durationSeconds * 1000`.
   - `getPlayerState(playerId)` filters active multipliers via `state.activeMultipliers.filter(m => m.expiresAt > now)`. Expired multipliers drop out automatically upon state inspection.

5. **Layout Compliance (`PROJECT.md`)**:
   - All source code resides under `server/src/engine/`.
   - All unit tests reside under `server/test/engine/`.
   - No source code or tests exist inside `.agents/` (only agent briefing and handoff metadata).

---

## 3. Caveats & Minor Observations

1. **24-Hour Streak Deduplication Lock Window**:
   - `RewardDispatcher` locks idempotency key `dedup:${playerId}:${ruleId}:streak:${newCount}` for 86,400 seconds (24h).
   - If a player reaches a 3-win streak, receives a reward, loses a match (streak resets to 0), and reaches a 3-win streak again on the same day, the second trigger receives `status: 'DEDUPED'`. This is standard anti-farm daily reward behavior.

2. **EventBus Listener Memory Warning under Test Instantiation**:
   - In heavy stress test environments with 100+ `RewardDispatcher` instances instantiated on the same `EventBus`, Node.js emits a `MaxListenersExceededWarning`. In production, `RewardDispatcher` is a singleton created once at server startup.

---

## 4. Conclusion & Verdict

**Verdict**: **APPROVE**

Milestone 2 (Strategy Rule Engine & Deduplication) strictly adheres to project architecture specifications, passes 100% of unit tests (85/85), compiles cleanly with zero TypeScript errors, and shows zero integrity violations.

---

## 5. Verification Method

To independently verify this verdict:

1. **Run Unit Test Suite**:
   ```bash
   cd /home/ebis/matiks/server
   npm test
   ```
   *Expected Output*: 9 test files passed, 85 tests passed.

2. **Run TypeScript Compiler Build**:
   ```bash
   cd /home/ebis/matiks/server
   npm run build
   ```
   *Expected Output*: Clean exit code `0` (`tsc` completion).

3. **Inspect Core Files**:
   - `/home/ebis/matiks/server/src/engine/strategies/StreakRuleStrategy.ts`
   - `/home/ebis/matiks/server/src/engine/strategies/CountInDayRuleStrategy.ts`
   - `/home/ebis/matiks/server/src/engine/strategies/CountInWindowRuleStrategy.ts`
   - `/home/ebis/matiks/server/src/engine/RuleIndexer.ts`
   - `/home/ebis/matiks/server/src/engine/RuleEngine.ts`
   - `/home/ebis/matiks/server/src/engine/RewardDispatcher.ts`
