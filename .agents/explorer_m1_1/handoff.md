# Handoff Report — Explorer M1 (Domain Core & KeyValueStore)

## 1. Observation

1. **Workspace & Environment State**:
   - Location: `/home/ebis/matiks`
   - Node.js Version: `v26.4.0`
   - npm Version: `12.0.1`
   - System: Arch Linux x86_64, 16 GB available RAM, 16 GB disk space available.
   - Project layout defined in `/home/ebis/matiks/.agents/orchestrator/PROJECT.md` specifies target path structure for backend server:
     ```
     server/
     ├── package.json
     ├── tsconfig.json
     └── src/
         ├── index.ts
         ├── store/
         │   └── KeyValueStore.ts
         ├── domain/
         │   ├── models.ts
         │   ├── EventBus.ts
         │   └── seedRules.ts
     ```

2. **Milestone 1 Scope & Feature Requirements**:
   - **In-memory KeyValueStore**:
     - String key-value `get`, `set`, `del`, `exists`, `ttl` with dual TTL cleanup (passive on read + active timer via `setTimeout`).
     - Atomic increment (`incrBy(key, amount, ttlSeconds?)`).
     - Set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`).
   - **Domain Core Models**:
     - Strongly typed interfaces: `MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`, `RewardConfig`, `ActiveMultiplier`.
   - **In-Memory Pub-Sub Event Bus**:
     - Event emitter supporting typed channels: `MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`.
   - **Seed Rules Registration**:
     - 3 startup rules:
       1. Streak: Win 3 matches in a row -> 50 coins (`rule_streak_3_wins`)
       2. Count in Day: Play 5 matches in a day -> 1 loot box (`rule_play_5_daily`)
       3. Count in Window: Win 2 algebra matches in 1 hour -> 2x multiplier for 30 minutes (`rule_win_2_algebra_1hr`)

---

## 2. Logic Chain

From the observed requirements and environment, we derive the technical architecture and implementation design for Milestone 1:

### A. KeyValueStore Dual Passive + Active Expiry Architecture
1. **Data Structure**:
   ```ts
   export type KeyValueType = 'string' | 'set';

   export interface StoreEntry {
     type: KeyValueType;
     value: string | Set<string>;
     expiresAt?: number; // epoch ms
     timerId?: NodeJS.Timeout;
   }
   ```
2. **Dual Expiry Strategy**:
   - **Passive Expiry (On-Read)**: Every read/write access (`get`, `exists`, `sMembers`, `incrBy`, `sAdd`, etc.) invokes `checkPassiveExpiry(key)`. If `Date.now() >= expiresAt`, `del(key)` is invoked immediately and `null`/`false`/`0` is returned. This guarantees that stale data is never exposed even if active timers lag.
   - **Active Expiry (Background Timer)**: When a key is set with `ttlSeconds > 0`, schedule `setTimeout(() => this.del(key), ttlSeconds * 1000)`. Call `timerId.unref()` on Node process to prevent active timers from blocking process exit during unit tests. If a key is deleted or re-set before expiration, `clearTimeout(timerId)` is called to prevent timer leaks.
3. **Atomic Increments (`incrBy`)**:
   - Checks passive expiry first.
   - If entry missing/expired, defaults base value to `0`, adds `amount`, stores as string.
   - If entry exists as string, parses integer `parseInt(entry.value, 10)`, adds `amount`, updates entry.
   - Optional `ttlSeconds` parameter refreshes or sets key expiration.
4. **Set Operations**:
   - Internal storage uses native JS `Set<string>`.
   - `sAdd`: Adds members, returns count of newly added members. If key was expired/missing, initializes new Set entry.
   - `sMembers`: Returns `Array.from(set)` or `[]`.
   - `sIsMember`: Returns `boolean`.
   - `sRem`: Removes member from set. If set becomes empty, deletes key entry.
   - `sCard`: Returns set cardinality (`set.size`).
5. **Teardown & Isolation**:
   - `flushAll()` method clears internal `Map` and cancels all active `timerId` handles. Vital for clean test isolation.

---

### B. Domain Models Architecture
All models must be defined in `server/src/domain/models.ts`:

1. **`RewardConfig`**:
   ```ts
   export type RewardType = 'COINS' | 'LOOT_BOX' | 'MULTIPLIER';

   export interface RewardConfig {
     type: RewardType;
     amount: number;
     durationSeconds?: number;
   }
   ```

2. **`MatchCompletedEvent`**:
   ```ts
   export interface MatchCompletedEvent {
     eventId: string;
     playerId: string;
     matchId: string;
     category: string;
     result: 'WIN' | 'LOSS' | 'DRAW';
     timestamp: number;
     metadata?: Record<string, unknown>;
   }
   ```

3. **`Rule`**:
   ```ts
   export type RuleType = 'STREAK' | 'COUNT_IN_DAY' | 'COUNT_IN_WINDOW';

   export interface Rule {
     id: string;
     name: string;
     description: string;
     type: RuleType;
     targetCount: number;
     category?: string;       // e.g. "algebra" or omitted for any
     resultFilter?: 'WIN' | 'LOSS'; // e.g. "WIN" or omitted for any
     windowSeconds?: number;  // required for COUNT_IN_WINDOW
     reward: RewardConfig;
     enabled: boolean;
     createdAt: number;
   }
   ```

4. **`RewardTriggeredEvent`**:
   ```ts
   export interface RewardTriggeredEvent {
     eventId: string;
     ruleId: string;
     ruleName: string;
     playerId: string;
     reward: RewardConfig;
     idempotencyKey: string;
     triggeredAt: number;
     matchEventId: string;
   }
   ```

5. **`PlayerState`**:
   ```ts
   export interface ActiveMultiplier {
     id: string;
     ruleId: string;
     multiplier: number;
     grantedAt: number;
     expiresAt: number;
   }

   export interface PlayerState {
     playerId: string;
     currentStreak: number;
     dailyMatchCount: number;
     dailyWinCount: number;
     windowedMatches: Array<{
       matchId: string;
       category: string;
       result: string;
       timestamp: number;
     }>;
     activeMultipliers: ActiveMultiplier[];
     inventory: {
       coins: number;
       lootBoxes: number;
     };
     lastUpdated: number;
   }
   ```

6. **`LedgerEntry`**:
   ```ts
   export interface LedgerEntry {
     id: string;
     playerId: string;
     ruleId: string;
     ruleName: string;
     reward: RewardConfig;
     idempotencyKey: string;
     grantedAt: number;
     status: 'GRANTED' | 'DEDUPED';
   }
   ```

---

### C. In-Memory Event Bus Architecture
Defined in `server/src/domain/EventBus.ts`:
```ts
import { EventEmitter } from 'events';
import { MatchCompletedEvent, RewardTriggeredEvent, LedgerEntry, PlayerState } from './models';

export interface EventMap {
  MatchCompleted: MatchCompletedEvent;
  RewardTriggered: RewardTriggeredEvent;
  RewardGranted: { ledgerEntry: LedgerEntry; playerState: PlayerState };
  RewardDeduped: { playerId: string; ruleId: string; idempotencyKey: string; timestamp: number };
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void | Promise<void>): this {
    this.emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  off<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): this {
    this.emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  removeAllListeners(event?: keyof EventMap): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}
```

---

### D. Seed Rules Registration Architecture
Defined in `server/src/domain/seedRules.ts`:
```ts
import { Rule } from './models';

export const SEED_RULES: Rule[] = [
  {
    id: 'rule_streak_3_wins',
    name: '3 Win Streak',
    description: 'Win 3 matches in a row to earn 50 coins',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'WIN',
    reward: {
      type: 'COINS',
      amount: 50,
    },
    enabled: true,
    createdAt: Date.now(),
  },
  {
    id: 'rule_play_5_daily',
    name: 'Daily 5 Matches',
    description: 'Play 5 matches in a day to earn 1 loot box',
    type: 'COUNT_IN_DAY',
    targetCount: 5,
    reward: {
      type: 'LOOT_BOX',
      amount: 1,
    },
    enabled: true,
    createdAt: Date.now(),
  },
  {
    id: 'rule_win_2_algebra_1hr',
    name: 'Algebra Master',
    description: 'Win 2 algebra matches within 1 hour to earn a 2x multiplier for 30 minutes',
    type: 'COUNT_IN_WINDOW',
    targetCount: 2,
    category: 'algebra',
    resultFilter: 'WIN',
    windowSeconds: 3600, // 1 hour window
    reward: {
      type: 'MULTIPLIER',
      amount: 2,
      durationSeconds: 1800, // 30 minutes duration
    },
    enabled: true,
    createdAt: Date.now(),
  },
];

export function getSeedRules(): Rule[] {
  return JSON.parse(JSON.stringify(SEED_RULES));
}
```

---

### E. Step-by-Step Implementation Plan for Implementer

1. **Step 1: Setup Server Workspace**:
   - Create `server/package.json` with scripts (`build`, `test`), dependencies (`express`, `socket.io`, `uuid`), and devDependencies (`typescript`, `tsx`, `@types/node`, `@types/express`, `vitest` or `jest`).
   - Create `server/tsconfig.json` targeting Node ES2022 with `moduleResolution: node` and `strict: true`.

2. **Step 2: Domain Core Models**:
   - Create `server/src/domain/models.ts` with all interfaces (`MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`, `RewardConfig`, `ActiveMultiplier`).

3. **Step 3: KeyValueStore Implementation**:
   - Create `server/src/store/KeyValueStore.ts`.
   - Implement `get`, `set`, `del`, `exists`, `ttl`, `incrBy`, `sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`, and `flushAll`.
   - Ensure passive expiry check is performed on all read/write paths and `timerId.unref()` is called on active timers.

4. **Step 4: In-Memory EventBus Implementation**:
   - Create `server/src/domain/EventBus.ts` wrapping Node's `EventEmitter` with strict generic types over `EventMap`.

5. **Step 5: Seed Rules Initializer**:
   - Create `server/src/domain/seedRules.ts` exporting `SEED_RULES` and `getSeedRules()`.

6. **Step 6: Unit Test Suite**:
   - Create `server/test/KeyValueStore.test.ts`: test TTL passive + active expiration, atomic `incrBy` with initial & existing values, set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`), and timer cleanup via `flushAll`.
   - Create `server/test/EventBus.test.ts`: test event subscription, emission, payload delivery, and handler cleanup.
   - Create `server/test/seedRules.test.ts`: test that seed rules conform to schema and load cleanly.

---

## 3. Caveats

- **Scope Limit**: Milestone 1 strictly covers KeyValueStore, Domain Core Models, EventBus, and Seed Rules. Strategy Evaluation Engine, Rule Indexer, Idempotency Dispatcher lock, REST API controllers, WebSocket emitters, and React UI components are reserved for Milestones 2 through 5.
- **Node.js Active Timer Teardown**: Node `setTimeout` handles must call `.unref()` so background timers do not hang test runner execution. Test teardowns (`afterEach` / `afterAll`) must invoke `store.flushAll()`.
- **Set Type Safety**: If a key exists as a string and a set operation (`sAdd`) is invoked on it, `KeyValueStore` should overwrite the entry with a new `Set` or throw an explicit type error. Overwriting with clean initialization is recommended for resilience.

---

## 4. Conclusion

Milestone 1 design is fully specified and architecturally sound. The KeyValueStore dual passive/active TTL strategy provides optimal balance between low read latency and memory leak prevention. Domain models, EventBus, and seed rules accurately reflect all requirements from `ORIGINAL_REQUEST.md` and `PROJECT.md`. The implementation plan is ready for immediate execution by the implementer agent.

---

## 5. Verification Method

To verify the completed Milestone 1 implementation:

1. **Verify Source Files Creation**:
   - Inspect files under `server/src/`:
     - `server/src/store/KeyValueStore.ts`
     - `server/src/domain/models.ts`
     - `server/src/domain/EventBus.ts`
     - `server/src/domain/seedRules.ts`

2. **Run Unit Test Suite**:
   ```bash
   cd /home/ebis/matiks/server && npm test
   ```
   *Expected*: All KeyValueStore, EventBus, and Seed Rules unit tests pass with 0 failures and exit cleanly without open handles.

3. **Verify Seed Rules Configuration**:
   - Validate that `getSeedRules()` returns exactly 3 rules matching the specs:
     - `rule_streak_3_wins` (Streak 3 WIN -> 50 COINS)
     - `rule_play_5_daily` (CountInDay 5 -> 1 LOOT_BOX)
     - `rule_win_2_algebra_1hr` (CountInWindow 2 WIN in 3600s -> 2x MULTIPLIER for 1800s)
