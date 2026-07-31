# Handoff Report — Explorer Milestone 1 (Domain Core & KeyValueStore)

## Observation

1. **Workspace & Existing Files**:
   - Location: `/home/ebis/matiks`
   - Existing structure: Clean workspace containing `ORIGINAL_REQUEST.md` and `.agents/` metadata directory.
   - Server directory (`server/`) is uncreated and ready for fresh setup.
   - Node.js runtime environment: `v26.4.0` with `npm v12.0.1`.

2. **Project Specification Requirements (from ORIGINAL_REQUEST.md & PROJECT.md)**:
   - **M1 Scope**:
     - `server/package.json` & `server/tsconfig.json` setup.
     - In-memory Redis-like `KeyValueStore` with TTL cleanup (passive + active), atomic increment (`incrBy`), and set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`).
     - Domain models in `server/src/domain/models.ts` (`MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`).
     - Pub-sub Event Bus in `server/src/domain/EventBus.ts` supporting events (`MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`).
     - Seed rules definition (`SEED_RULES`) for startup registration (Streak 3 wins -> 50 coins, Play 5/day -> 1 loot box, Win 2 algebra in 1h -> 2x multiplier for 30m).
     - Unit test plan and test suite setup using `vitest`.

---

## Logic Chain

1. **Module & Tooling Strategy**:
   - Node.js v26.4.0 natively supports ES Modules (`"type": "module"` in `package.json`).
   - Using `tsx` allows executing TypeScript files directly in dev mode without separate build steps.
   - `vitest` is chosen for unit testing because it runs directly against TypeScript source without requiring `ts-jest` transpilation overhead, supports modern ESM, and provides fast test execution.

2. **KeyValueStore Architecture**:
   - Internal storage uses a type-safe tagged union `StoreEntry` (`StringEntry`, `CounterEntry`, `SetEntry`) stored in a `Map<string, StoreEntry>`.
   - **Passive Expiration**: Checked on key lookup/access. If `Date.now() >= expiresAt`, the entry is automatically purged from the Map and treated as non-existent.
   - **Active Expiration**: A background timer runs every 5 seconds (configurable) to purge expired keys. A `close()` method is provided to stop the interval cleanly during unit test execution or process shutdown.
   - **Atomic Increments**: `incrBy(key, amount, ttlSeconds)` creates or updates counter entries safely.
   - **Set Operations**: `sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard` manage set structures in-memory.
   - **TTL Query**: `ttl(key)` returns `-2` if non-existent/expired, `-1` if persistent, or remaining seconds as an integer.

3. **Domain Models & Seed Rules**:
   - `models.ts` defines explicit TypeScript interfaces for all domain events, player metrics, ledger entries, and rules.
   - `SEED_RULES` satisfies R1 requirements:
     1. Streak rule: Win 3 matches in a row -> 50 coins (`rule_streak_win_3`).
     2. Daily count rule: Play 5 matches in a day -> 1 loot box (`rule_daily_5`).
     3. Windowed count rule: Win 2 algebra matches in 1 hour -> 2x multiplier for 30 min (`rule_algebra_win_2_1h`).

4. **In-Memory EventBus**:
   - Wraps Node's native `EventEmitter` with strong TypeScript typing via an `EventMap` interface.
   - Provides type-safe `emit`, `on`, and `off` methods for `MatchCompleted`, `RewardTriggered`, `RewardGranted`, and `RewardDeduped` events.

---

## Caveats

- **Scope Boundary**: Milestone 1 strictly covers state storage (`KeyValueStore`), domain core models, `SEED_RULES`, and `EventBus`. Rule evaluation logic (strategies, indexer, dispatcher lock) belongs to Milestone 2; REST API & WebSockets belong to Milestone 3; UI belongs to Milestone 4.
- **Background Cleanup Timers**: Unit tests must call `store.close()` or initialize `KeyValueStore` without background active cleanup intervals to avoid lingering timer handles during test teardown.

---

## Conclusion & Detailed Technical Blueprint

### 1. Directory & File Structure
```
server/
├── package.json
├── tsconfig.json
└── src/
    ├── store/
    │   ├── KeyValueStore.ts
    │   └── __tests__/
    │       └── KeyValueStore.test.ts
    └── domain/
        ├── models.ts
        ├── EventBus.ts
        └── __tests__/
            ├── EventBus.test.ts
            └── models.test.ts
```

---

### 2. File Implementation Specifications

#### A. `server/package.json`
```json
{
  "name": "player-reward-rule-engine-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.0",
    "tsx": "^4.15.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

#### B. `server/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### C. `server/src/domain/models.ts`
```typescript
export type MatchResult = 'WIN' | 'LOSS';

export interface MatchCompletedEvent {
  eventId: string;
  playerId: string;
  result: MatchResult;
  category: string;
  timestamp: number; // Unix timestamp in ms
  metadata?: Record<string, unknown>;
}

export type RuleType = 'streak' | 'count_in_day' | 'count_in_window';

export interface StreakConfig {
  requiredStreak: number;
  matchResult: MatchResult;
}

export interface CountInDayConfig {
  requiredCount: number;
}

export interface CountInWindowConfig {
  requiredCount: number;
  windowSeconds: number;
  matchResult?: MatchResult;
}

export type RuleConfig = StreakConfig | CountInDayConfig | CountInWindowConfig;

export type RewardType = 'COINS' | 'LOOT_BOX' | 'MULTIPLIER';

export interface RewardConfig {
  type: RewardType;
  amount: number;
  multiplierValue?: number;
  durationSeconds?: number;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  type: RuleType;
  category: string; // '*' for all categories, or specific e.g. 'algebra'
  config: RuleConfig;
  reward: RewardConfig;
  enabled: boolean;
}

export interface RewardTriggeredEvent {
  eventId: string;
  ruleId: string;
  playerId: string;
  reward: RewardConfig;
  idempotencyKey: string;
  triggeredAt: number;
  triggerContext: {
    matchEventId: string;
    currentCountOrStreak: number;
    threshold: number;
  };
}

export interface ActiveMultiplier {
  id: string;
  multiplierValue: number;
  expiresAt: number; // Unix timestamp ms
  ruleId: string;
}

export interface WindowedMatchRecord {
  matchId: string;
  timestamp: number;
  category: string;
  result: MatchResult;
}

export interface PlayerState {
  playerId: string;
  currentStreak: number;
  dailyMatches: number;
  dailyMatchesDate: string; // 'YYYY-MM-DD'
  windowedMatches: WindowedMatchRecord[];
  activeMultipliers: ActiveMultiplier[];
  totalRewardsGranted: number;
  coins: number;
  lootBoxes: number;
  lastUpdated: number;
}

export interface LedgerEntry {
  id: string;
  idempotencyKey: string;
  playerId: string;
  ruleId: string;
  ruleName: string;
  reward: RewardConfig;
  grantedAt: number;
  matchEventId: string;
}

export const SEED_RULES: Rule[] = [
  {
    id: 'rule_streak_win_3',
    name: 'Winning Streak',
    description: 'Win 3 matches in a row to earn 50 coins',
    type: 'streak',
    category: '*',
    config: {
      requiredStreak: 3,
      matchResult: 'WIN'
    },
    reward: {
      type: 'COINS',
      amount: 50
    },
    enabled: true
  },
  {
    id: 'rule_daily_5',
    name: 'Daily Grinder',
    description: 'Play 5 matches in a single day to earn 1 Loot Box',
    type: 'count_in_day',
    category: '*',
    config: {
      requiredCount: 5
    },
    reward: {
      type: 'LOOT_BOX',
      amount: 1
    },
    enabled: true
  },
  {
    id: 'rule_algebra_win_2_1h',
    name: 'Algebra Master',
    description: 'Win 2 algebra matches within 1 hour to activate 2x multiplier for 30 minutes',
    type: 'count_in_window',
    category: 'algebra',
    config: {
      requiredCount: 2,
      windowSeconds: 3600,
      matchResult: 'WIN'
    },
    reward: {
      type: 'MULTIPLIER',
      amount: 1,
      multiplierValue: 2,
      durationSeconds: 1800
    },
    enabled: true
  }
];
```

#### D. `server/src/domain/EventBus.ts`
```typescript
import { EventEmitter } from 'events';
import { MatchCompletedEvent, RewardTriggeredEvent, LedgerEntry } from './models.js';

export interface RewardDedupedPayload {
  idempotencyKey: string;
  playerId: string;
  ruleId: string;
  timestamp: number;
}

export interface EventMap {
  MatchCompleted: MatchCompletedEvent;
  RewardTriggered: RewardTriggeredEvent;
  RewardGranted: LedgerEntry;
  RewardDeduped: RewardDedupedPayload;
}

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  public on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): this {
    this.emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  public off<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): this {
    this.emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  public removeAllListeners(event?: keyof EventMap): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}

export const eventBus = new EventBus();
```

#### E. `server/src/store/KeyValueStore.ts`
```typescript
type KeyType = 'string' | 'counter' | 'set';

interface BaseEntry {
  type: KeyType;
  expiresAt?: number; // Unix timestamp in ms
}

interface StringEntry extends BaseEntry {
  type: 'string';
  value: string;
}

interface CounterEntry extends BaseEntry {
  type: 'counter';
  value: number;
}

interface SetEntry extends BaseEntry {
  type: 'set';
  members: Set<string>;
}

type StoreEntry = StringEntry | CounterEntry | SetEntry;

export class KeyValueStore {
  private store = new Map<string, StoreEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(enableActiveCleanup = true, cleanupIntervalMs = 5000) {
    if (enableActiveCleanup) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredKeys();
      }, cleanupIntervalMs);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  private isExpired(entry: BaseEntry): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() >= entry.expiresAt;
  }

  private checkAndExpire(key: string): StoreEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private cleanupExpiredKeys(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && now >= entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  // --- String Operations ---

  public async get(key: string): Promise<string | null> {
    const entry = this.checkAndExpire(key);
    if (!entry || entry.type !== 'string') return null;
    return entry.value;
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { type: 'string', value, expiresAt });
    return true;
  }

  public async del(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  public async exists(key: string): Promise<boolean> {
    return this.checkAndExpire(key) !== undefined;
  }

  // --- Counter Operations ---

  public async incrBy(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const entry = this.checkAndExpire(key);
    let newValue = amount;
    let expiresAt: number | undefined = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;

    if (entry) {
      if (entry.type === 'counter') {
        newValue = entry.value + amount;
        expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : entry.expiresAt;
      }
    }

    this.store.set(key, { type: 'counter', value: newValue, expiresAt });
    return newValue;
  }

  public async getCounter(key: string): Promise<number | null> {
    const entry = this.checkAndExpire(key);
    if (!entry || entry.type !== 'counter') return null;
    return entry.value;
  }

  // --- Set Operations ---

  public async sAdd(key: string, member: string, ttlSeconds?: number): Promise<boolean> {
    let entry = this.checkAndExpire(key);
    let isNew = false;

    if (!entry || entry.type !== 'set') {
      const set = new Set<string>();
      set.add(member);
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
      this.store.set(key, { type: 'set', members: set, expiresAt });
      return true;
    }

    isNew = !entry.members.has(member);
    entry.members.add(member);
    if (ttlSeconds) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
    return isNew;
  }

  public async sMembers(key: string): Promise<string[]> {
    const entry = this.checkAndExpire(key);
    if (!entry || entry.type !== 'set') return [];
    return Array.from(entry.members);
  }

  public async sIsMember(key: string, member: string): Promise<boolean> {
    const entry = this.checkAndExpire(key);
    if (!entry || entry.type !== 'set') return false;
    return entry.members.has(member);
  }

  public async sRem(key: string, member: string): Promise<boolean> {
    const entry = this.checkAndExpire(key);
    if (!entry || entry.type !== 'set') return false;
    return entry.members.delete(member);
  }

  public async sCard(key: string): Promise<number> {
    const entry = this.checkAndExpire(key);
    if (!entry || entry.type !== 'set') return 0;
    return entry.members.size;
  }

  // --- TTL Operations ---

  public async ttl(key: string): Promise<number> {
    const entry = this.checkAndExpire(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    const remainingMs = entry.expiresAt - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : -2;
  }

  public async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.checkAndExpire(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  // --- Utility Operations ---

  public async flushAll(): Promise<void> {
    this.store.clear();
  }

  public async keys(pattern?: string): Promise<string[]> {
    const activeKeys: string[] = [];
    for (const key of Array.from(this.store.keys())) {
      if (this.checkAndExpire(key)) {
        if (!pattern || pattern === '*' || key.includes(pattern.replace('*', ''))) {
          activeKeys.push(key);
        }
      }
    }
    return activeKeys;
  }

  public close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
```

---

### 3. Unit Test Plan

#### A. `server/src/store/__tests__/KeyValueStore.test.ts`
- **String Specs**:
  - `set` & `get`: Store and retrieve string values correctly.
  - `exists` & `del`: Verify presence check and deletion behavior.
- **TTL Expiration Specs**:
  - Passive expiry: Set key with TTL of 1 sec, wait 1.1s, assert `get` returns `null` and `exists` returns `false`.
  - `ttl()` return values: returns `-2` for missing keys, `-1` for persistent keys, and `>0` for active TTL keys.
  - `expire()`: Update existing key TTL dynamically.
- **Atomic Counter Specs**:
  - `incrBy`: Initialize counter on missing key, increment existing counter by positive and negative values.
  - `incrBy` with TTL: Ensure expiration timestamp persists or updates on increment.
- **Set Operations Specs**:
  - `sAdd` & `sMembers`: Add elements, assert array representation.
  - `sIsMember`: Assert true for included elements, false for omitted.
  - `sRem` & `sCard`: Remove element, assert correct cardinal count.

#### B. `server/src/domain/__tests__/EventBus.test.ts`
- **Event Dispatch Specs**:
  - Subscribe to `MatchCompleted`, emit event, assert listener receives exact event payload.
  - Subscribe to `RewardTriggered`, `RewardGranted`, `RewardDeduped`.
  - Verify listener cleanup via `off` and `removeAllListeners`.

#### C. `server/src/domain/__tests__/models.test.ts`
- **Seed Rules Specs**:
  - Validate `SEED_RULES` array has length 3.
  - Verify seed rule types (`streak`, `count_in_day`, `count_in_window`) and associated configurations match R1 specifications.

---

## Verification Method

After Implementer M1 creates the files and installs dependencies in `server/`:

1. **Install Dependencies**:
   ```bash
   cd /home/ebis/matiks/server && npm install
   ```
2. **Execute Unit Tests**:
   ```bash
   cd /home/ebis/matiks/server && npm test
   ```
   *Expected Result*: All tests pass in `KeyValueStore.test.ts`, `EventBus.test.ts`, and `models.test.ts`.

3. **Verify TypeScript Compilation**:
   ```bash
   cd /home/ebis/matiks/server && npm run build
   ```
   *Expected Result*: `tsc` completes cleanly without any type errors and outputs to `dist/`.
