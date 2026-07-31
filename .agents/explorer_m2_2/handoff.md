# Milestone 2 Unit Testing Strategy & TypeScript Interface Contracts — Handoff Report

## Executive Summary
This report defines the exact TypeScript interface contracts, file layout, and comprehensive unit testing strategy for Milestone 2: Strategy Rule Engine & Deduplication. Baseline verification confirms all 59 existing M1 tests in `server/` are passing (`vitest run`).

---

## 1. Observation

### 1.1 Existing Core Domain Models and KeyValueStore
- **`server/src/domain/models.ts`** (Lines 1-85):
  - Defines `RuleType = 'STREAK' | 'COUNT_IN_DAY' | 'COUNT_IN_WINDOW'`.
  - Defines `MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`, `ActiveMultiplier`, `RewardConfig`.
- **`server/src/store/KeyValueStore.ts`** (Lines 21-270):
  - Key-Value store with passive/active TTL, `incrBy(key, amount, ttlSeconds)`, `sAdd(key, members, ttlSeconds)`, `sMembers(key)`, `sRem(key, members)`, `sIsMember(key, member)`, `sCard(key)`.
- **`server/src/domain/EventBus.ts`** (Lines 16-21):
  - Defines event map: `MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`.
- **`server/package.json`** (Lines 9-10):
  - Test runner script: `"test": "vitest run"`.
- **Test execution baseline**:
  - `npm test` executed in `server/` succeeded with 59 passing tests across 5 files (`KeyValueStore.test.ts`, `EventBus.test.ts`, `seedRules.test.ts`, `empirical_verification.test.ts`, `stress.test.ts`).

---

## 2. Logic Chain

1. **Strategy Pattern Design**:
   - Each rule strategy (`StreakRuleStrategy`, `CountInDayRuleStrategy`, `CountInWindowRuleStrategy`) must implement a unified `RuleStrategy` interface.
   - The strategy receives a `MatchCompletedEvent`, the target `Rule`, and the `KeyValueStore` instance.
   - The evaluation result returns a `RuleEvaluationResult` containing `triggered: boolean`, `currentCount: number`, `targetCount: number`, and `idempotencyKey?: string`.

2. **Rule Indexing Design**:
   - `RuleIndexer` maintains composite keys formatted as `category:result` (e.g. `algebra:WIN`).
   - Wildcards are indexed using `*` (e.g. `algebra:*`, `*:WIN`, `*:*`).
   - Lookup queries all 4 potential candidate buckets, deduplicates candidate rule IDs, and filters out `enabled === false` rules.

3. **Reward Dispatcher & Deduplication Lock Design**:
   - `RewardDispatcher` receives `RewardTriggeredEvent` items.
   - It performs atomic idempotency lock checks in `KeyValueStore` using key `lock:idempotency:${event.idempotencyKey}`.
   - If key exists: emits `RewardDeduped` event via `EventBus`, creates a `LedgerEntry` with `status: 'DEDUPED'`, leaves `PlayerState` unchanged.
   - If key does not exist: acquires lock in `KeyValueStore` with 24h TTL, creates a `LedgerEntry` with `status: 'GRANTED'`, updates `PlayerState` (coins, loot boxes, or active multipliers), and emits `RewardGranted` event via `EventBus`.

---

## 3. Exact TypeScript Interface Contracts & File Structure

### 3.1 Target File Structure
```
server/
├── src/
│   └── engine/
│       ├── strategies/
│       │   ├── RuleStrategy.ts
│       │   ├── StreakRuleStrategy.ts
│       │   ├── CountInDayRuleStrategy.ts
│       │   └── CountInWindowRuleStrategy.ts
│       ├── RuleIndexer.ts
│       ├── RuleEngine.ts
│       └── RewardDispatcher.ts
└── test/
    └── engine/
        ├── StreakRuleStrategy.test.ts
        ├── CountInDayRuleStrategy.test.ts
        ├── CountInWindowRuleStrategy.test.ts
        ├── RuleIndexer.test.ts
        ├── RuleEngine.test.ts
        └── RewardDispatcher.test.ts
```

### 3.2 Exact Type Signatures

#### A. Strategy Interface (`server/src/engine/strategies/RuleStrategy.ts`)
```ts
import { MatchCompletedEvent, Rule, RuleType } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  currentCount: number;
  targetCount: number;
  idempotencyKey?: string;
  reason?: string;
  counterKey?: string;
  ttlSeconds?: number;
}

export interface RuleStrategy {
  readonly type: RuleType;
  evaluate(
    event: MatchCompletedEvent,
    rule: Rule,
    store: KeyValueStore
  ): Promise<RuleEvaluationResult>;
}
```

#### B. StreakRuleStrategy (`server/src/engine/strategies/StreakRuleStrategy.ts`)
```ts
import { RuleStrategy, RuleEvaluationResult } from './RuleStrategy';
import { MatchCompletedEvent, Rule } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export class StreakRuleStrategy implements RuleStrategy {
  readonly type = 'STREAK';

  public async evaluate(
    event: MatchCompletedEvent,
    rule: Rule,
    store: KeyValueStore
  ): Promise<RuleEvaluationResult> {
    const requiredResult = rule.resultFilter ?? 'WIN';
    const counterKey = `player:${event.playerId}:streak:${rule.id}`;

    // Filter check: If category does not match, return untriggered result
    if (rule.category && rule.category !== event.category) {
      const current = parseInt((await store.get(counterKey)) ?? '0', 10);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: false,
        currentCount: current,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Category mismatch',
      };
    }

    if (event.result === requiredResult) {
      const newCount = await store.incrBy(counterKey, 1);
      const triggered = newCount >= rule.targetCount;
      const idempotencyKey = `${event.playerId}:${rule.id}:streak:${newCount}`;

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered,
        currentCount: newCount,
        targetCount: rule.targetCount,
        idempotencyKey,
        counterKey,
      };
    } else {
      // LOSS or non-matching result resets streak counter to 0
      await store.set(counterKey, '0');
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Streak broken by non-matching result',
      };
    }
  }
}
```

#### C. CountInDayRuleStrategy (`server/src/engine/strategies/CountInDayRuleStrategy.ts`)
```ts
import { RuleStrategy, RuleEvaluationResult } from './RuleStrategy';
import { MatchCompletedEvent, Rule } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export class CountInDayRuleStrategy implements RuleStrategy {
  readonly type = 'COUNT_IN_DAY';

  public async evaluate(
    event: MatchCompletedEvent,
    rule: Rule,
    store: KeyValueStore
  ): Promise<RuleEvaluationResult> {
    if (rule.category && rule.category !== event.category) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        reason: 'Category mismatch',
      };
    }

    if (rule.resultFilter && rule.resultFilter !== event.result) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        reason: 'Result filter mismatch',
      };
    }

    const dateStr = new Date(event.timestamp).toISOString().split('T')[0];
    const counterKey = `player:${event.playerId}:daily:${rule.id}:${dateStr}`;
    const ttlSeconds = 86400; // 24 hours

    const newCount = await store.incrBy(counterKey, 1, ttlSeconds);
    const triggered = newCount >= rule.targetCount;
    const idempotencyKey = `${event.playerId}:${rule.id}:${dateStr}`;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      triggered,
      currentCount: newCount,
      targetCount: rule.targetCount,
      idempotencyKey,
      counterKey,
      ttlSeconds,
    };
  }
}
```

#### D. CountInWindowRuleStrategy (`server/src/engine/strategies/CountInWindowRuleStrategy.ts`)
```ts
import { RuleStrategy, RuleEvaluationResult } from './RuleStrategy';
import { MatchCompletedEvent, Rule } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export class CountInWindowRuleStrategy implements RuleStrategy {
  readonly type = 'COUNT_IN_WINDOW';

  public async evaluate(
    event: MatchCompletedEvent,
    rule: Rule,
    store: KeyValueStore
  ): Promise<RuleEvaluationResult> {
    const windowSeconds = rule.windowSeconds ?? 3600;
    const counterKey = `player:${event.playerId}:window:${rule.id}`;

    if (rule.category && rule.category !== event.category) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Category mismatch',
      };
    }

    if (rule.resultFilter && rule.resultFilter !== event.result) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Result filter mismatch',
      };
    }

    // Retrieve existing set members
    const members = await store.sMembers(counterKey);
    const cutoff = event.timestamp - windowSeconds * 1000;
    const validMembers: Array<{ matchId: string; timestamp: number }> = [];
    const expiredMembers: string[] = [];

    for (const m of members) {
      try {
        const parsed = JSON.parse(m);
        if (parsed.timestamp >= cutoff) {
          validMembers.push(parsed);
        } else {
          expiredMembers.push(m);
        }
      } catch {
        expiredMembers.push(m);
      }
    }

    // Prune expired members
    if (expiredMembers.length > 0) {
      await store.sRem(counterKey, expiredMembers);
    }

    // Add current event
    const newMemberObj = { matchId: event.matchId, timestamp: event.timestamp };
    const newMemberStr = JSON.stringify(newMemberObj);
    await store.sAdd(counterKey, newMemberStr, windowSeconds);

    validMembers.push(newMemberObj);
    const validCount = validMembers.length;
    const triggered = validCount >= rule.targetCount;

    // Idempotency key based on time bucket
    const timeBucket = Math.floor(event.timestamp / (windowSeconds * 1000));
    const idempotencyKey = `${event.playerId}:${rule.id}:win_${timeBucket}`;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      triggered,
      currentCount: validCount,
      targetCount: rule.targetCount,
      idempotencyKey,
      counterKey,
      ttlSeconds: windowSeconds,
    };
  }
}
```

#### E. RuleIndexer (`server/src/engine/RuleIndexer.ts`)
```ts
import { Rule, MatchResult } from '../domain/models';

export class RuleIndexer {
  private rulesMap = new Map<string, Rule>();
  private index = new Map<string, Set<string>>();

  private makeKey(category?: string, result?: MatchResult): string {
    const c = category && category !== '' ? category : '*';
    const r = result && result !== '' ? result : '*';
    return `${c}:${r}`;
  }

  public registerRule(rule: Rule): void {
    this.rulesMap.set(rule.id, rule);
    const key = this.makeKey(rule.category, rule.resultFilter);

    if (!this.index.has(key)) {
      this.index.set(key, new Set());
    }
    this.index.get(key)!.add(rule.id);
  }

  public unregisterRule(ruleId: string): boolean {
    const rule = this.rulesMap.get(ruleId);
    if (!rule) return false;

    const key = this.makeKey(rule.category, rule.resultFilter);
    const ruleSet = this.index.get(key);
    if (ruleSet) {
      ruleSet.delete(ruleId);
    }
    return this.rulesMap.delete(ruleId);
  }

  public getCandidateRules(category: string, result: MatchResult): Rule[] {
    const keys = [
      `${category}:${result}`,
      `${category}:*`,
      `*:${result}`,
      `*:*`,
    ];

    const candidateIds = new Set<string>();
    for (const k of keys) {
      const set = this.index.get(k);
      if (set) {
        set.forEach((id) => candidateIds.add(id));
      }
    }

    const resultRules: Rule[] = [];
    candidateIds.forEach((id) => {
      const rule = this.rulesMap.get(id);
      if (rule && rule.enabled) {
        resultRules.push(rule);
      }
    });

    return resultRules;
  }

  public getAllRules(): Rule[] {
    return Array.from(this.rulesMap.values());
  }

  public getRule(ruleId: string): Rule | undefined {
    return this.rulesMap.get(ruleId);
  }

  public clear(): void {
    this.rulesMap.clear();
    this.index.clear();
  }
}
```

#### F. RewardDispatcher (`server/src/engine/RewardDispatcher.ts`)
```ts
import { KeyValueStore } from '../store/KeyValueStore';
import { EventBus } from '../domain/EventBus';
import { RewardTriggeredEvent, LedgerEntry, PlayerState } from '../domain/models';
import { v4 as uuidv4 } from 'uuid';

export interface DispatchResult {
  status: 'GRANTED' | 'DEDUPED';
  ledgerEntry: LedgerEntry;
  playerState?: PlayerState;
}

export class RewardDispatcher {
  private ledger: LedgerEntry[] = [];
  private playerStates = new Map<string, PlayerState>();

  constructor(
    private store: KeyValueStore,
    private eventBus: EventBus
  ) {
    this.eventBus.on('RewardTriggered', async (event) => {
      await this.dispatch(event);
    });
  }

  public async dispatch(event: RewardTriggeredEvent): Promise<DispatchResult> {
    const lockKey = `lock:idempotency:${event.idempotencyKey}`;
    const lockExists = await this.store.exists(lockKey);
    const now = Date.now();

    if (lockExists) {
      const ledgerEntry: LedgerEntry = {
        id: uuidv4(),
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

    // Acquire lock with 24h TTL
    await this.store.set(lockKey, '1', 86400);

    // Fetch or create player state
    let state = this.playerStates.get(event.playerId);
    if (!state) {
      state = {
        playerId: event.playerId,
        currentStreak: 0,
        dailyMatchCount: 0,
        dailyWinCount: 0,
        windowedMatches: [],
        activeMultipliers: [],
        inventory: { coins: 0, lootBoxes: 0 },
        lastUpdated: now,
      };
      this.playerStates.set(event.playerId, state);
    }

    // Update inventory based on reward type
    if (event.reward.type === 'COINS') {
      state.inventory.coins += event.reward.amount;
    } else if (event.reward.type === 'LOOT_BOX') {
      state.inventory.lootBoxes += event.reward.amount;
    } else if (event.reward.type === 'MULTIPLIER') {
      const durationMs = (event.reward.durationSeconds ?? 1800) * 1000;
      state.activeMultipliers.push({
        id: uuidv4(),
        ruleId: event.ruleId,
        multiplier: event.reward.amount,
        grantedAt: now,
        expiresAt: now + durationMs,
      });
    }
    state.lastUpdated = now;

    const ledgerEntry: LedgerEntry = {
      id: uuidv4(),
      playerId: event.playerId,
      ruleId: event.ruleId,
      ruleName: event.ruleName,
      reward: event.reward,
      idempotencyKey: event.idempotencyKey,
      grantedAt: now,
      status: 'GRANTED',
    };
    this.ledger.push(ledgerEntry);

    this.eventBus.emit('RewardGranted', {
      ledgerEntry,
      playerState: state,
    });

    return { status: 'GRANTED', ledgerEntry, playerState: state };
  }

  public getLedger(): LedgerEntry[] {
    return [...this.ledger];
  }

  public async getPlayerState(playerId: string): Promise<PlayerState> {
    let state = this.playerStates.get(playerId);
    if (!state) {
      state = {
        playerId,
        currentStreak: 0,
        dailyMatchCount: 0,
        dailyWinCount: 0,
        windowedMatches: [],
        activeMultipliers: [],
        inventory: { coins: 0, lootBoxes: 0 },
        lastUpdated: Date.now(),
      };
      this.playerStates.set(playerId, state);
    }
    return state;
  }

  public clear(): void {
    this.ledger = [];
    this.playerStates.clear();
  }
}
```

---

## 4. Test Suite Plan

### 4.1 Test File Matrix
1. `server/test/engine/StreakRuleStrategy.test.ts` (6 test cases)
2. `server/test/engine/CountInDayRuleStrategy.test.ts` (5 test cases)
3. `server/test/engine/CountInWindowRuleStrategy.test.ts` (5 test cases)
4. `server/test/engine/RuleIndexer.test.ts` (7 test cases)
5. `server/test/engine/RewardDispatcher.test.ts` (5 test cases)
6. `server/test/engine/RuleEngine.test.ts` (4 integration unit test cases)

### 4.2 Test Suite Specification Details

#### Test Suite 1: StreakRuleStrategy Test Suite (`server/test/engine/StreakRuleStrategy.test.ts`)
- `it('increments streak counter on consecutive WINs without triggering prior to threshold')`:
  - Input: 2 WIN matches for rule with `targetCount: 3`.
  - Assertions: match 1 returns `currentCount: 1, triggered: false`; match 2 returns `currentCount: 2, triggered: false`.
- `it('triggers threshold on 3rd WIN match')`:
  - Input: 3rd WIN match.
  - Assertions: returns `triggered: true`, `idempotencyKey: 'p1:rule_streak_3_wins:streak:3'`.
- `it('resets streak counter to 0 on LOSS match')`:
  - Input: 2 WINs followed by 1 LOSS.
  - Assertions: LOSS match returns `currentCount: 0, triggered: false`. Next WIN returns `currentCount: 1`.
- `it('resets streak counter on DRAW match when resultFilter is WIN')`:
  - Input: 2 WINs followed by 1 DRAW.
  - Assertions: returns `currentCount: 0`.
- `it('ignores matches with non-matching category')`:
  - Input: Rule with `category: 'algebra'`. Match with `category: 'geography'`.
  - Assertions: `triggered: false`, counter in store remains unmodified.
- `it('generates consistent idempotency key on threshold')`:
  - Assertions: `idempotencyKey` matches format `${playerId}:${ruleId}:streak:${currentCount}`.

#### Test Suite 2: CountInDayRuleStrategy Test Suite (`server/test/engine/CountInDayRuleStrategy.test.ts`)
- `it('increments daily count on matches within same UTC date')`:
  - Input: 4 matches on `2026-07-31T10:00:00Z` for daily 5 rule.
  - Assertions: `currentCount` reaches 4, `triggered: false`.
- `it('triggers reward on 5th daily match')`:
  - Input: 5th match on `2026-07-31T18:00:00Z`.
  - Assertions: `triggered: true`, `idempotencyKey: 'p1:rule_play_5_daily:2026-07-31'`.
- `it('resets counter bucket across UTC date rollover')`:
  - Input: 4 matches on `2026-07-31T23:59:50Z`, 1 match on `2026-08-01T00:00:05Z`.
  - Assertions: Match on Aug 1 returns `currentCount: 1, triggered: false`.
- `it('sets 24-hour TTL on daily counter key in KeyValueStore')`:
  - Assertions: Store TTL for `player:p1:daily:rule_play_5_daily:2026-07-31` is `<= 86400` and `> 0`.
- `it('respects category and result filter for daily rules')`:
  - Assertions: non-matching category/result does not increment counter.

#### Test Suite 3: CountInWindowRuleStrategy Test Suite (`server/test/engine/CountInWindowRuleStrategy.test.ts`)
- `it('accumulates valid matches within sliding window')`:
  - Input: 2 algebra WIN matches within 30 minutes for a 1-hour window rule (`targetCount: 2`).
  - Assertions: 1st match returns `currentCount: 1`, 2nd returns `currentCount: 2, triggered: true`.
- `it('prunes expired matches outside sliding window')`:
  - Input: Match 1 at `t0`, Match 2 at `t0 + 3700000` (61.6 minutes later).
  - Assertions: Match 1 is pruned (`sRem`), `currentCount: 1, triggered: false`.
- `it('handles burst of matches inside window correctly')`:
  - Input: 3 matches at `t0`, `t0 + 10s`, `t0 + 20s`.
  - Assertions: 2nd match triggers, 3rd match returns `currentCount: 3, triggered: true`.
- `it('sets TTL equal to windowSeconds on set key in store')`:
  - Assertions: `store.ttl(counterKey)` returns value `<= 3600` and `> 0`.
- `it('ignores non-matching category or result events')`:
  - Assertions: Non-matching match not added to window set.

#### Test Suite 4: RuleIndexer Test Suite (`server/test/engine/RuleIndexer.test.ts`)
- `it('indexes and retrieves exact category:result rules')`:
  - Category `algebra`, result `WIN` -> retrieves exact rule.
- `it('matches wildcard category rules (category undefined)')`:
  - Rule with no category matches any category query.
- `it('matches wildcard resultFilter rules (resultFilter undefined)')`:
  - Rule with no resultFilter matches any result query.
- `it('matches double wildcard rules (category undefined, resultFilter undefined)')`:
  - Rule matches all queries.
- `it('supports dynamic rule addition at runtime')`:
  - Calling `registerRule(newRule)` immediately includes `newRule` in candidate queries.
- `it('filters out disabled rules')`:
  - Rule with `enabled: false` is excluded from candidate lookup.
- `it('supports rule unregistration')`:
  - Calling `unregisterRule(ruleId)` removes rule from candidate results.

#### Test Suite 5: RewardDispatcher Test Suite (`server/test/engine/RewardDispatcher.test.ts`)
- `it('grants reward on first trigger and sets idempotency lock with TTL')`:
  - Input: `RewardTriggeredEvent`.
  - Assertions: `dispatch` returns `status: 'GRANTED'`, store contains `lock:idempotency:${key}` with 24h TTL, `RewardGranted` event emitted.
- `it('deduplicates reward on duplicate trigger with same idempotency key')`:
  - Input: Second `RewardTriggeredEvent` with same `idempotencyKey`.
  - Assertions: `dispatch` returns `status: 'DEDUPED'`, ledger has 2 entries (1 GRANTED, 1 DEDUPED), `RewardDeduped` event emitted.
- `it('updates player inventory for COINS and LOOT_BOX rewards')`:
  - Input: COINS reward (50) and LOOT_BOX reward (1).
  - Assertions: `playerState.inventory.coins === 50`, `playerState.inventory.lootBoxes === 1`.
- `it('adds active multiplier with correct expiration timestamp')`:
  - Input: MULTIPLIER reward (2x, 1800s).
  - Assertions: `playerState.activeMultipliers` contains 1 element with `expiresAt = grantedAt + 1800000`.
- `it('maintains ordered ledger history')`:
  - Assertions: `getLedger()` returns all entries in chronological order.

---

## 5. Caveats
- **Time/Clock Dependency**: Tests involving sliding windows or daily UTC dates must format ISO strings or relative offsets deterministically (e.g. using fixed timestamps or mock timers).
- **Concurrency**: `KeyValueStore` operations are synchronous JavaScript in-memory operations in Node single-thread runtime, ensuring atomic step execution per async tick.

---

## 6. Conclusion
The proposed TypeScript interface contracts and unit testing strategy fully address all Milestone 2 requirements:
1. `StreakRuleStrategy` correctly handles streak counts, threshold triggers, idempotency keys, and resets on LOSS/DRAW.
2. `CountInDayRuleStrategy` manages UTC date buckets, 24h TTLs, and daily thresholds.
3. `CountInWindowRuleStrategy` enforces sliding window member pruning and threshold evaluation.
4. `RuleIndexer` provides O(1) candidate lookup with wildcard expansion and dynamic runtime rule registration.
5. `RewardDispatcher` provides deduplication via KeyValueStore idempotency locks, maintains ledger history, and updates player inventory state.

---

## 7. Verification Method

To verify the Milestone 2 design:
1. Run existing baseline test suite:
   ```bash
   cd /home/ebis/matiks/server
   npm test
   ```
2. Once M2 implementation and test files are written, execute:
   ```bash
   cd /home/ebis/matiks/server
   npx vitest run test/engine/
   ```
3. Ensure all tests in `test/engine/*.test.ts` pass with 100% coverage across strategy logic, indexer wildcards, and dispatcher deduplication locks.
