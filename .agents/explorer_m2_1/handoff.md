# Technical Blueprint & Handoff Report: Milestone 2 (Strategy Rule Engine & Deduplication)

**Agent**: Explorer 1  
**Milestone**: M2 (Strategy Rule Engine & Deduplication)  
**Target Output**: `/home/ebis/matiks/.agents/explorer_m2_1/handoff.md`  
**Date**: 2026-07-31  

---

## 1. Observation

Direct code inspection of the existing codebase revealed the following structural details:

1. **Domain Models (`server/src/domain/models.ts`)**:
   - `MatchCompletedEvent` (lines 13-21): `eventId`, `playerId`, `matchId`, `category`, `result` ('WIN' | 'LOSS' | 'DRAW'), `timestamp`, `metadata`.
   - `Rule` (lines 23-35): `id`, `name`, `description`, `type` ('STREAK' | 'COUNT_IN_DAY' | 'COUNT_IN_WINDOW'), `targetCount`, `category`, `resultFilter`, `windowSeconds`, `reward` (`RewardConfig`), `enabled`, `createdAt`.
   - `RewardTriggeredEvent` (lines 37-46): `eventId`, `ruleId`, `ruleName`, `playerId`, `reward`, `idempotencyKey`, `triggeredAt`, `matchEventId`.
   - `PlayerState` (lines 56-73): `playerId`, `currentStreak`, `dailyMatchCount`, `dailyWinCount`, `windowedMatches`, `activeMultipliers`, `inventory` (`coins`, `lootBoxes`), `lastUpdated`.
   - `LedgerEntry` (lines 75-84): `id`, `playerId`, `ruleId`, `ruleName`, `reward`, `idempotencyKey`, `grantedAt`, `status` ('GRANTED' | 'DEDUPED').

2. **In-Memory Store (`server/src/store/KeyValueStore.ts`)**:
   - String key operations: `get(key)`, `set(key, value, ttlSeconds)`, `incrBy(key, amount, ttlSeconds)`, `exists(key)`, `del(key)`.
   - Set key operations: `sAdd(key, members, ttlSeconds)`, `sMembers(key)`, `sIsMember(key, member)`, `sRem(key, members)`, `sCard(key)`.
   - Automatic passive expiry (`checkPassiveExpiry`) and active TTL timers (`unref()`).

3. **Internal Event Bus (`server/src/domain/EventBus.ts`)**:
   - Typed events (lines 16-21): `MatchCompleted`, `RewardTriggered`, `RewardGranted` (payload: `{ ledgerEntry, playerState }`), `RewardDeduped` (payload: `{ playerId, ruleId, idempotencyKey, timestamp }`).

4. **Seed Rules (`server/src/domain/seedRules.ts`)**:
   - `rule_streak_3_wins`: STREAK, targetCount 3, resultFilter WIN -> grant 50 coins.
   - `rule_play_5_daily`: COUNT_IN_DAY, targetCount 5 -> grant 1 loot box.
   - `rule_win_2_algebra_1hr`: COUNT_IN_WINDOW, targetCount 2, category 'algebra', resultFilter WIN, windowSeconds 3600 -> activate 2x multiplier for 30m.

---

## 2. Logic Chain

From the observations above, we deduce the step-by-step implementation requirement for Milestone 2:

### Step 1: Strategy Implementations (`server/src/engine/strategies/`)

#### 1.1 Strategy Interface (`RuleStrategy.ts`)
```ts
export interface StrategyEvaluationResult {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggered: boolean;
  currentCount: number;
  targetCount: number;
  idempotencyKey?: string;
}

export interface RuleStrategy {
  evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<StrategyEvaluationResult>;
}
```

#### 1.2 Streak Strategy (`StreakRuleStrategy.ts`)
- **Key**: `player:${event.playerId}:streak`
- **Evaluation Logic**:
  1. If `event.result === 'LOSS'`:
     - Reset streak counter to `0`: `await store.set(streakKey, '0')`.
     - Return `{ ruleId: rule.id, ruleName: rule.name, ruleType: rule.type, triggered: false, currentCount: 0, targetCount: rule.targetCount }`.
  2. If `rule.resultFilter` is set and `event.result !== rule.resultFilter`:
     - Fetch current streak: `val = await store.get(streakKey); currentCount = parseInt(val || '0', 10)`.
     - Return `{ ruleId: rule.id, ruleName: rule.name, ruleType: rule.type, triggered: false, currentCount, targetCount: rule.targetCount }`.
  3. If `event.result` matches `rule.resultFilter` (or `rule.resultFilter` is omitted/wildcard):
     - Increment streak: `currentCount = await store.incrBy(streakKey, 1)`.
     - Evaluate trigger: `triggered = currentCount >= rule.targetCount && (currentCount % rule.targetCount === 0 || currentCount === rule.targetCount)`.
     - Idempotency key: `${event.playerId}:${rule.id}:streak:${currentCount}`.
     - Return result with `triggered`, `currentCount`, `targetCount`, and `idempotencyKey`.

#### 1.3 Count-In-Day Strategy (`CountInDayRuleStrategy.ts`)
- **Key**: `player:${event.playerId}:daily:${YYYY-MM-DD}` where `YYYY-MM-DD` is derived from `new Date(event.timestamp).toISOString().split('T')[0]`.
- **Evaluation Logic**:
  1. Check filter criteria: if `rule.resultFilter` is set and `event.result !== rule.resultFilter`, or if `rule.category` is set and `event.category.toLowerCase() !== rule.category.toLowerCase()`, skip increment and return `triggered: false`.
  2. Increment daily counter: `currentCount = await store.incrBy(dailyKey, 1, 86400)` (24-hour TTL).
  3. Evaluate trigger: `triggered = currentCount >= rule.targetCount`.
  4. Idempotency key: `${event.playerId}:${rule.id}:${dateStr}` (locks single reward per rule per UTC day).
  5. Return result with `triggered`, `currentCount`, `targetCount`, and `idempotencyKey`.

#### 1.4 Count-In-Window Strategy (`CountInWindowRuleStrategy.ts`)
- **Key**: `player:${event.playerId}:window:${rule.id}`
- **Evaluation Logic**:
  1. Check filter criteria: if `rule.category` is set and `event.category.toLowerCase() !== rule.category.toLowerCase()`, or if `rule.resultFilter` is set and `event.result !== rule.resultFilter`, return `triggered: false`.
  2. Add current match timestamp to Set: `memberStr = `${event.timestamp}:${event.matchId}``, `await store.sAdd(windowKey, memberStr, rule.windowSeconds || 3600)`.
  3. Read all members: `allMembers = await store.sMembers(windowKey)`.
  4. Filter active vs expired timestamps:
     - `cutoff = event.timestamp - (rule.windowSeconds || 3600) * 1000`.
     - Active members: `timestamp >= cutoff`.
     - Expired members: `timestamp < cutoff`.
  5. Cleanup expired members: if `expiredMembers.length > 0`, call `await store.sRem(windowKey, expiredMembers)`.
  6. `currentCount = activeMembers.length`.
  7. Evaluate trigger: `triggered = currentCount >= rule.targetCount`.
  8. Idempotency key: `timeBucket = Math.floor(event.timestamp / ((rule.windowSeconds || 3600) * 1000))`, key: `${event.playerId}:${rule.id}:${timeBucket}`.
  9. Return result with `triggered`, `currentCount`, `targetCount`, and `idempotencyKey`.

---

### Step 2: Rule Indexer (`server/src/engine/RuleIndexer.ts`)

- **Composite Key Format**: `${category}:${resultFilter}`
  - Wildcard representation: `*` when category or resultFilter is omitted.
  - Examples: `*:WIN` (3 Win Streak), `*:*` (Daily 5 Matches), `algebra:WIN` (Algebra Master).

- **Data Structures**:
  - `indexMap: Map<string, Set<Rule>>` (maps index composite key to set of rules).
  - `rulesMap: Map<string, Rule>` (maps `ruleId` to `Rule`).

- **Key Methods**:
  1. `registerRule(rule: Rule): void`
     - Computes `catKey = rule.category ? rule.category.toLowerCase() : '*'`.
     - Computes `resKey = rule.resultFilter ? rule.resultFilter : '*'`.
     - Index key = `${catKey}:${resKey}`.
     - Adds rule to `indexMap.get(indexKey)` and `rulesMap.set(rule.id, rule)`.
  2. `getCandidateRules(category: string, result: string): Rule[]`
     - Computes `cat = category.toLowerCase()`, `res = result`.
     - Lookups 4 candidate composite keys:
       1. `${cat}:${res}` (Exact category & exact result)
       2. `*:${res}` (Wildcard category & exact result)
       3. `${cat}:*` (Exact category & wildcard result)
       4. `*:*` (Wildcard category & wildcard result)
     - Aggregates rules from all 4 keys into a deduplicated array.
     - Filters for `rule.enabled === true`.
     - Returns candidate `Rule[]` in O(1) key lookup time.
  3. `getAllRules(): Rule[]`
     - Returns `Array.from(this.rulesMap.values())`.

---

### Step 3: Rule Engine (`server/src/engine/RuleEngine.ts`)

- **Dependencies**: `KeyValueStore`, `EventBus`, `RuleIndexer`, strategy instances (`StreakRuleStrategy`, `CountInDayRuleStrategy`, `CountInWindowRuleStrategy`).
- **Data Structure**: `EvaluationTrace`
  ```ts
  export interface EvaluationTrace {
    matchEvent: MatchCompletedEvent;
    candidateRules: Rule[];
    evaluations: StrategyEvaluationResult[];
    triggeredRewards: RewardTriggeredEvent[];
    evaluatedAt: number;
    executionTimeMs: number;
  }
  ```
- **Execution Flow (`evaluateMatch(event: MatchCompletedEvent)`)**:
  1. Record start time (`performance.now()`).
  2. Candidate lookup: `candidateRules = this.indexer.getCandidateRules(event.category, event.result)`.
  3. Strategy evaluation: iterate over candidate rules, delegate to strategy mapped by `rule.type`.
  4. Collect evaluation results (`StrategyEvaluationResult[]`).
  5. Filter triggered evaluations (`evalResult.triggered === true`).
  6. Emit `RewardTriggered` events:
     For each triggered evaluation, construct `RewardTriggeredEvent`:
     ```ts
     const triggeredEvent: RewardTriggeredEvent = {
       eventId: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
       ruleId: rule.id,
       ruleName: rule.name,
       playerId: event.playerId,
       reward: rule.reward,
       idempotencyKey: evalResult.idempotencyKey!,
       triggeredAt: Date.now(),
       matchEventId: event.eventId,
     };
     this.eventBus.emit('RewardTriggered', triggeredEvent);
     ```
  7. Construct and return full `EvaluationTrace`.

---

### Step 4: Reward Dispatcher (`server/src/engine/RewardDispatcher.ts`)

- **Dependencies**: `KeyValueStore`, `EventBus`.
- **In-Memory Ledger**: `ledger: LedgerEntry[] = []`.
- **Execution Flow (`dispatchReward(triggeredEvent: RewardTriggeredEvent)`)**:
  1. Deduplication Lock Key: `dedupKey = dedup:${triggeredEvent.idempotencyKey}`.
  2. Deduplication Check: `const isLocked = await store.exists(dedupKey)`.
  3. **Duplicate Branch (`isLocked === true`)**:
     - Create `LedgerEntry` with `status: 'DEDUPED'`.
     - Push to `ledger`.
     - Emit `RewardDeduped` event on `EventBus`:
       `eventBus.emit('RewardDeduped', { playerId, ruleId, idempotencyKey, timestamp: Date.now() })`.
     - Return `LedgerEntry`.
  4. **Granted Branch (`isLocked === false`)**:
     - Acquire Lock: `await store.set(dedupKey, '1', 86400)` (24h TTL lock).
     - Apply Reward to Player State:
       - Update player inventory (`coins += reward.amount` for 'COINS', `lootBoxes += reward.amount` for 'LOOT_BOX').
       - For 'MULTIPLIER', append active multiplier record with `expiresAt = Date.now() + (reward.durationSeconds || 1800) * 1000`.
       - Persist updated state to store (`player:${playerId}:state`).
     - Create `LedgerEntry` with `status: 'GRANTED'`.
     - Push to `ledger`.
     - Emit `RewardGranted` event on `EventBus`:
       `eventBus.emit('RewardGranted', { ledgerEntry, playerState })`.
     - Return `LedgerEntry`.
- **State Aggregator (`getPlayerState(playerId: string)`)**:
  - Aggregates streak from `player:${playerId}:streak`, daily count from `player:${playerId}:daily:${todayStr}`, active multipliers (filtering out `expiresAt < Date.now()`), and current inventory.

---

## 3. Caveats

- **State Store Concurrency**: Node.js standard event loop handles requests sequentially in a single thread. As `KeyValueStore` operations are synchronous map operations wrapped in promises, no explicit lock contention issues exist.
- **Date Formatting**: `CountInDayRuleStrategy` uses ISO UTC string prefix (`YYYY-MM-DD`) to guarantee consistent daily rollover across time zones.

---

## 4. Conclusion

The architecture for Milestone 2 (Strategy Rule Engine & Deduplication) is fully mapped to the domain models and `KeyValueStore` methods created in Milestone 1. The Strategy pattern cleanly isolates calculation algorithms, `RuleIndexer` guarantees O(1) candidate lookup using composite wildcard indexing, and `RewardDispatcher` ensures strict single-grant idempotency backed by TTL key locks.

---

## 5. Verification Method

To verify the Milestone 2 implementation:

1. **Unit Tests**:
   - Run `npm test` inside `server/` after implementing strategies, indexer, engine, and dispatcher.
   - Verify test suite tests:
     - `StreakRuleStrategy`: increment on WIN, reset to 0 on LOSS.
     - `CountInDayRuleStrategy`: daily UTC key increment & 24h TTL setting.
     - `CountInWindowRuleStrategy`: sliding window member addition and purging of expired timestamps `< now - windowSeconds`.
     - `RuleIndexer`: exact composite key lookup (`algebra:WIN`) and wildcard fallbacks (`*:WIN`, `algebra:*`, `*:*`).
     - `RewardDispatcher`: initial trigger grants reward with `GRANTED` status; identical trigger with same idempotency key produces `DEDUPED` status and emits `RewardDeduped`.

2. **File Inspection**:
   - Check created strategy files in `server/src/engine/strategies/` (`RuleStrategy.ts`, `StreakRuleStrategy.ts`, `CountInDayRuleStrategy.ts`, `CountInWindowRuleStrategy.ts`).
   - Check `server/src/engine/RuleIndexer.ts`.
   - Check `server/src/engine/RuleEngine.ts`.
   - Check `server/src/engine/RewardDispatcher.ts`.
