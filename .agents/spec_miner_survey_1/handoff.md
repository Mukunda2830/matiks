# Handoff Report: Specification Mining for Event-Driven Player Reward Rule Engine

## 1. Observation

A detailed analysis was conducted on `/home/ebis/matiks/ORIGINAL_REQUEST.md` (78 lines, 4058 bytes) to extract all functional, technical, architectural, and data contract requirements for the Player Reward Rule Engine system.

The core specification spans 4 required domain areas:
1. **KeyValueStore**: In-memory Redis-like state store supporting key-value operations, relative TTL cleanup (passive + active), atomic increment operations, and set operations (`sadd`, `smembers`, `sismember`, `srem`, `scard`).
2. **Domain Core & Event Bus**: Domain models (`MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`), in-memory pub-sub event bus (`MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`), and startup seed rules.
3. **Strategy-based Rule Engine & Indexing**: Strategy pattern implementations (`StreakRuleStrategy`, `CountInDayRuleStrategy`, `CountInWindowRuleStrategy`), category/result rule indexing for $O(1)$ candidate retrieval, and TTL-backed idempotency deduplication keys (`playerId + ruleId + timeBucket`).
4. **REST API & WebSocket Real-Time Pipeline**: 6 REST endpoints (`POST /api/simulate-match`, `POST /api/simulate-burst`, `GET /api/rules`, `POST /api/rules`, `GET /api/players/:id/state`, `GET /api/ledger`) and 6 pipeline stage WebSocket events (`MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, `COUNTERS_UPDATED`, `THRESHOLD_MET`, `REWARD_GRANTED`, `REWARD_DEDUPED`).

---

## 2. Logic Chain

1. **State Store Architecture**: Stateful evaluation (streaks, daily counts, sliding windows, deduplication locks) requires an isolated, high-performance in-memory KeyValueStore. Methods must be atomic within Node.js event-loop turns to handle concurrent simulations cleanly.
2. **Domain Engine & Strategy Pattern**: Matching incoming events against rules using dedicated strategy classes decouples evaluation logic from state storage and HTTP/WS transport.
3. **Performance Indexing**: Evaluating candidate rules via a composite index `(category:result)` prevents linear $O(N)$ rule scans during event bursts.
4. **Deduplication Strategy**: Distinguishing between rule qualification and reward distribution prevents duplicate reward exploits (e.g. repeated burst requests). Idempotency keys must expire using KeyValueStore TTLs.
5. **Observability & Pipeline Emitted Events**: Socket.IO events decouple execution trace reporting from core evaluation, enabling real-time step progression on the visualizer frontend.

---

## 3. Caveats

- **Timezone Conventions**: `CountInDayRuleStrategy` uses UTC date representations (`YYYY-MM-DD`) for day bucket keys.
- **Deduplication Bucketing**: Time buckets for idempotency keys correspond to the evaluation grain (e.g., UTC date string for daily rules, window bucket or match trigger instance for streak/window rules).
- **Scope Exclusion**: Out-of-scope elements specified by AC ("Zero dead-letter queues, event replay, or compound rules in implementation") are explicitly excluded from requirements.

---

## 4. Conclusion & Detailed Requirements

### Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | KeyValueStore | String Storage & Retrieval | Get and set key-value string/JSON entries | `key: string`, `val: string/any` | `value` / `boolean` | Missing key returns `null` | ORIGINAL_REQUEST.md R1 |
| 2 | KeyValueStore | TTL Expiration | Support key expiration with TTL seconds | `key: string`, `ttlSeconds: number` | `boolean` | Expired keys deleted and return `null` | ORIGINAL_REQUEST.md R1, AC |
| 3 | KeyValueStore | Atomic Increment | Increment integer value stored at key atomically | `key: string`, `amount: number` | `number` (new value) | Non-numeric value resets to amount or throws error | ORIGINAL_REQUEST.md R1, AC |
| 4 | KeyValueStore | Set Operations | Add (`sadd`), list (`smembers`), check (`sismember`), remove (`srem`), card (`scard`) | `key: string`, `members: string[]` | Set members / boolean / count | Non-set key type error | ORIGINAL_REQUEST.md R1, AC |
| 5 | Domain Models | MatchCompletedEvent Schema | Represents a completed match event payload | `id`, `playerId`, `result` ('WIN'\|'LOSS'), `category`, `timestamp` | Typed Object | Missing fields return 400 Bad Request | ORIGINAL_REQUEST.md R1, R3 |
| 6 | Domain Models | Rule Schema | Schema for configurable reward evaluation rules | `id`, `name`, `type`, `conditions`, `reward` | Typed Object | Invalid strategy type or conditions return 400 | ORIGINAL_REQUEST.md R1, R2 |
| 7 | Domain Models | RewardTriggeredEvent Schema | Event payload emitted when rule conditions are satisfied | `id`, `matchId`, `playerId`, `ruleId`, `reward`, `idempotencyKey`, `timestamp` | Event Payload | N/A | ORIGINAL_REQUEST.md R1 |
| 8 | Domain Models | PlayerState Schema | Aggregated player state representation | `playerId`, `streakCounters`, `dailyCounters`, `windowEvents`, `activeMultipliers` | JSON Object | Default zero-state returned for new players | ORIGINAL_REQUEST.md R1, R3 |
| 9 | Domain Models | LedgerEntry Schema | Audit record for granted or deduped rewards | `id`, `timestamp`, `playerId`, `ruleId`, `ruleName`, `reward`, `idempotencyKey`, `status` | JSON Object | N/A | ORIGINAL_REQUEST.md R1, R3, AC |
| 10 | Domain Event Bus | Internal Event Bus | In-memory pub-sub event emitter | Channel name, payload data | Void | Listener errors logged without crashing pipeline | ORIGINAL_REQUEST.md R1 |
| 11 | Seed Rules | System Seed Rules | Startup registration of 3 pre-configured rules | Application init | 3 registered `Rule` objects | Skipped if already registered | ORIGINAL_REQUEST.md R1 |
| 12 | Strategy Engine | StreakRuleStrategy | Tracks consecutive WIN matches; resets counter to 0 on LOSS | `Rule`, `MatchCompletedEvent`, `PlayerState` | `EvaluationResult` | LOSS resets counter to 0 | ORIGINAL_REQUEST.md R1, R2, AC |
| 13 | Strategy Engine | CountInDayRuleStrategy | Counts match completions in UTC day bucket (`YYYY-MM-DD`) | `Rule`, `MatchCompletedEvent`, `PlayerState` | `EvaluationResult` | Handled via TTL / daily key rollover | ORIGINAL_REQUEST.md R1, R2, AC |
| 14 | Strategy Engine | CountInWindowRuleStrategy | Counts match events within sliding timestamp window | `Rule`, `MatchCompletedEvent`, `PlayerState` | `EvaluationResult` | Prunes expired timestamps on read | ORIGINAL_REQUEST.md R1, R2, AC |
| 15 | Rule Indexing | Category & Result Rule Index | Hash map index `(category:result)` for O(1) candidate lookup | Event `category` & `result` | Candidate `Rule[]` array | Fallback to wildcard `*` rules | ORIGINAL_REQUEST.md R2 |
| 16 | Deduplication | Idempotency Key Locks | TTL lock check (`playerId + ruleId + timeBucket`) in KeyValueStore | `idempotencyKey`, `TTL` | `boolean` (isDuplicate) | If key exists, emit `REWARD_DEDUPED` | ORIGINAL_REQUEST.md R2, AC |
| 17 | REST API | `POST /api/simulate-match` | Process single match event and return full evaluation trace | JSON match payload | Trace JSON response | 400 Bad Request on invalid body | ORIGINAL_REQUEST.md R3, AC |
| 18 | REST API | `POST /api/simulate-burst` | Process batch of N matches with inter-event delays | JSON `{ playerId, matchCount, ... }` | Summary response | 400 Bad Request if matchCount <= 0 | ORIGINAL_REQUEST.md R3, AC |
| 19 | REST API | `GET /api/rules` | Retrieve list of all currently active rules | None | `Rule[]` array | 500 on internal failure | ORIGINAL_REQUEST.md R3 |
| 20 | REST API | `POST /api/rules` | Dynamically register a new rule and update index | JSON `Rule` body | Created `Rule` object | 400 Bad Request on missing fields | ORIGINAL_REQUEST.md R3, AC |
| 21 | REST API | `GET /api/players/:id/state` | Retrieve aggregated player counters, multipliers, state | `id` route parameter | `PlayerState` JSON | 404 or default state | ORIGINAL_REQUEST.md R3 |
| 22 | REST API | `GET /api/ledger` | Retrieve audit log of all reward grants & deduplications | Query params | `LedgerEntry[]` array | 500 on internal failure | ORIGINAL_REQUEST.md R3, AC |
| 23 | WebSocket Pipeline | Socket.IO Stage Emissions | Emit WebSocket events for 6 visualization stages | Event bus triggers | Socket.IO broadcasts | Client reconnect support | ORIGINAL_REQUEST.md R3, AC |

---

### Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | KeyValueStore Incr | Incrementing a non-numeric string key | Returns error or initializes key to target increment amount |
| 2 | KeyValueStore TTL | Accessing a key after its TTL seconds have elapsed | Returns `null`/`undefined`; key is removed from memory lazily or during background sweep |
| 3 | StreakRuleStrategy | Player suffers a LOSS after achieving 2 WINs | Streak counter immediately resets to 0 in KeyValueStore; no reward triggered |
| 4 | CountInDayRuleStrategy | Player plays match across UTC midnight boundary | Day bucket key changes (e.g. `day:2026-07-30` -> `day:2026-07-31`), resetting daily counter to 1 |
| 5 | CountInWindowRuleStrategy | Match timestamps older than sliding window duration | Timestamps older than `now - windowSeconds` are filtered out during evaluation |
| 6 | Idempotency Key Lock | Two identical match events trigger same rule within lock TTL | First event emits `REWARD_GRANTED` and writes status `GRANTED` to ledger; second event hits lock, emits `REWARD_DEDUPED`, writes status `DEDUPED` |
| 7 | Dynamic Rule Indexing | New rule added via `POST /api/rules` | Rule is assigned ID, added to memory store and rule index map; subsequent match simulations evaluate it immediately |
| 8 | Rule Index Lookup | Match event category or result has no exact index match | Index retriever queries wildcard keys `*:WIN`, `algebra:*`, `*:*` to ensure all relevant rules evaluate |
| 9 | Simulate Burst API | Request burst simulation of 20 matches for player | Pipeline executes 20 match evaluations sequentially/asynchronously with `delayMs`; WS updates stream stage events for each match |
| 10 | Active Multipliers | Active multiplier duration expires | `PlayerState` query filters out multipliers where `expiresAt <= Date.now()` |

---

## 5. Detailed Technical Specifications

### Domain Area 1: KeyValueStore Interface & Operations

```typescript
export interface KeyValueStore {
  // String operations
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  
  // Atomic operations
  incrBy(key: string, amount: number, ttlSeconds?: number): Promise<number>;
  
  // Set operations
  sAdd(key: string, member: string): Promise<boolean>;
  sMembers(key: string): Promise<string[]>;
  sIsMember(key: string, member: string): Promise<boolean>;
  sRem(key: string, member: string): Promise<boolean>;
  sCard(key: string): Promise<number>;
  
  // Expiry management
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>; // returns remaining TTL in seconds or -1 if no TTL, -2 if missing
  flush(): Promise<void>;
}
```

- **Cleanup Mechanism**: Expired keys are removed passively on read (`get`, `sMembers`, `incrBy`) and actively via a periodic background timer (e.g. every 5 seconds).

---

### Domain Area 2: Domain Core Models & Event Bus

#### Data Schemas

```typescript
export type MatchResult = 'WIN' | 'LOSS';

export interface MatchCompletedEvent {
  id: string;            // unique match event ID (UUID v4)
  playerId: string;      // target player ID
  result: MatchResult;   // match result outcome ('WIN' | 'LOSS')
  category: string;      // match category (e.g., 'algebra', 'general', 'calculus')
  timestamp: number;     // epoch ms
}

export type RuleType = 'streak' | 'count_in_day' | 'count_in_window';

export interface RuleConditions {
  targetCount: number;           // target threshold count (e.g., 3, 5, 2)
  requiredResult?: MatchResult;  // optional result filter ('WIN' | 'LOSS')
  category?: string;             // optional category filter (e.g. 'algebra') or '*'
  windowSeconds?: number;        // time window in seconds (for count_in_window)
}

export interface RewardDefinition {
  type: 'coins' | 'loot_box' | 'multiplier'; // reward type
  value: number;                              // amount or multiplier value (e.g. 50, 1, 2)
  durationSeconds?: number;                   // duration for multiplier reward (e.g. 1800 for 30m)
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  type: RuleType;
  conditions: RuleConditions;
  reward: RewardDefinition;
}

export interface RewardTriggeredEvent {
  id: string;
  matchId: string;
  playerId: string;
  ruleId: string;
  ruleName: string;
  reward: RewardDefinition;
  idempotencyKey: string;
  timestamp: number;
}

export interface ActiveMultiplier {
  value: number;        // e.g. 2 for 2x multiplier
  expiresAt: number;    // epoch ms expiry time
  ruleId: string;
}

export interface PlayerState {
  playerId: string;
  currentStreak: number;
  dailyCount: number;
  windowedCount: number;
  activeMultipliers: ActiveMultiplier[];
}

export interface LedgerEntry {
  id: string;
  timestamp: number;
  matchId: string;
  playerId: string;
  ruleId: string;
  ruleName: string;
  reward: RewardDefinition;
  idempotencyKey: string;
  status: 'GRANTED' | 'DEDUPED';
}
```

#### Seed Rules Specification

1. **Seed Rule 1 (Streak)**:
   - `id`: `"rule-streak-win-3"`
   - `name`: `"Win 3 Matches in a Row"`
   - `type`: `"streak"`
   - `conditions`: `{ targetCount: 3, requiredResult: "WIN" }`
   - `reward`: `{ type: "coins", value: 50 }`
2. **Seed Rule 2 (Count in Day)**:
   - `id`: `"rule-daily-play-5"`
   - `name`: `"Play 5 Matches in a Day"`
   - `type`: `"count_in_day"`
   - `conditions`: `{ targetCount: 5 }`
   - `reward`: `{ type: "loot_box", value: 1 }`
3. **Seed Rule 3 (Count in Window)**:
   - `id`: `"rule-window-algebra-2"`
   - `name`: `"Win 2 Algebra Matches in 1 Hour"`
   - `type`: `"count_in_window"`
   - `conditions`: `{ targetCount: 2, requiredResult: "WIN", category: "algebra", windowSeconds: 3600 }`
   - `reward`: `{ type: "multiplier", value: 2, durationSeconds: 1800 }`

#### Internal Event Bus

- Channel Names:
  - `MatchCompleted`: Emitted when a new match is submitted.
  - `RewardTriggered`: Emitted when a rule strategy evaluation succeeds.
  - `RewardGranted`: Emitted when deduplication passes and reward is added to ledger.
  - `RewardDeduped`: Emitted when deduplication lock indicates a duplicate reward trigger.

---

### Domain Area 3: Strategy-Based Rule Engine & Indexing

#### Rule Evaluation Strategy Interface

```typescript
export interface RuleStrategy {
  evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<{
    triggered: boolean;
    currentCount: number;
    targetCount: number;
    idempotencyKey: string;
  }>;
}
```

- **StreakRuleStrategy**:
  - Store key: `player:${playerId}:streak`
  - If `event.result === rule.conditions.requiredResult` (or requiredResult is undefined), increment streak via `incrBy(key, 1)`.
  - If `event.result !== rule.conditions.requiredResult`, reset streak via `set(key, "0")`.
  - Return `triggered: currentCount >= rule.conditions.targetCount`. Idempotency key: `${playerId}:${rule.id}:${currentCount}`.

- **CountInDayRuleStrategy**:
  - Store key: `player:${playerId}:daily:${dateString}` (where dateString is `YYYY-MM-DD` UTC).
  - Increment daily counter via `incrBy(key, 1, 86400)`.
  - Return `triggered: currentCount >= rule.conditions.targetCount`. Idempotency key: `${playerId}:${rule.id}:${dateString}`.

- **CountInWindowRuleStrategy**:
  - Store key: `player:${playerId}:window:${rule.id}`.
  - If match satisfies `requiredResult` and `category` filters, store timestamp in set/list.
  - Read timestamps, remove items older than `now - windowSeconds`.
  - Return `triggered: remainingTimestamps.length >= rule.conditions.targetCount`. Idempotency key: `${playerId}:${rule.id}:${latestTimestampWindowBucket}`.

#### Rule Indexing Strategy

- Maintains an index map: `Map<string, Rule[]>`.
- Index key format: `${category}:${result}` (e.g. `algebra:WIN`, `general:LOSS`).
- Wildcards `*` are used for unconstrained categories or results: `*:WIN`, `algebra:*`, `*:*`.
- When querying candidate rules for event `(category='algebra', result='WIN')`, candidate keys fetched are:
  - `algebra:WIN`
  - `algebra:*`
  - `*:WIN`
  - `*:*`
- Dynamic addition via `POST /api/rules` automatically inserts the new rule into the corresponding index buckets.

#### Idempotency Key Deduplication

- Deduplication Key: `dedup:${playerId}:${ruleId}:${timeBucket}`.
- KeyValueStore check: `set(dedupKey, "LOCKED", ttlSeconds)`.
- If key already exists in KeyValueStore, operation returns `false` (duplicate). Dispatcher emits `RewardDeduped` event and logs ledger entry with status `'DEDUPED'`.
- If key does not exist, operation returns `true` (granted). Dispatcher emits `RewardGranted` event and logs ledger entry with status `'GRANTED'`.

---

### Domain Area 4: REST API & WebSocket Real-Time Pipeline

#### REST Endpoints

1. `POST /api/simulate-match`
   - **Request**: `{ "playerId": "p1", "result": "WIN", "category": "algebra", "timestamp"?: 1700000000000 }`
   - **Response (200 OK)**:
     ```json
     {
       "success": true,
       "matchEvent": { "id": "m-123", "playerId": "p1", "result": "WIN", "category": "algebra", "timestamp": 1700000000000 },
       "evaluatedRules": 3,
       "triggeredRewards": [ ... ],
       "dedupedRewards": [ ... ],
       "trace": [ ... ]
     }
     ```

2. `POST /api/simulate-burst`
   - **Request**: `{ "playerId": "p1", "matchCount": 5, "result": "WIN", "category": "algebra", "delayMs": 100 }`
   - **Response (200 OK)**: `{ "success": true, "processedMatches": 5, "totalRewardsGranted": 2, "totalRewardsDeduped": 0 }`

3. `GET /api/rules`
   - **Response (200 OK)**: Array of registered `Rule` objects `Rule[]`.

4. `POST /api/rules`
   - **Request**: `Omit<Rule, "id">` (or full `Rule`).
   - **Response (201 Created)**: Created `Rule` object with generated `id`.

5. `GET /api/players/:id/state`
   - **Response (200 OK)**: `PlayerState` object containing `currentStreak`, `dailyCount`, `windowedCount`, `activeMultipliers`.

6. `GET /api/ledger`
   - **Response (200 OK)**: Array of `LedgerEntry[]` objects.

#### WebSocket Pipeline Stage Events (Socket.IO)

1. `MATCH_RECEIVED`: `{ "matchId": "m-123", "playerId": "p1", "result": "WIN", "category": "algebra", "timestamp": 1700000000000 }`
2. `RULE_CANDIDATES_FOUND`: `{ "matchId": "m-123", "candidateRuleIds": ["rule-streak-win-3", "rule-window-algebra-2"], "count": 2 }`
3. `COUNTERS_UPDATED`: `{ "matchId": "m-123", "playerId": "p1", "counters": { "streak": 3, "daily": 1, "window": 2 } }`
4. `THRESHOLD_MET`: `{ "matchId": "m-123", "playerId": "p1", "ruleId": "rule-streak-win-3", "ruleName": "Win 3 Matches in a Row", "targetCount": 3, "currentCount": 3 }`
5. `REWARD_GRANTED`: `{ "matchId": "m-123", "playerId": "p1", "ruleId": "rule-streak-win-3", "reward": { "type": "coins", "value": 50 }, "idempotencyKey": "p1:rule-streak-win-3:3", "ledgerId": "ledg-456" }`
6. `REWARD_DEDUPED`: `{ "matchId": "m-123", "playerId": "p1", "ruleId": "rule-streak-win-3", "idempotencyKey": "p1:rule-streak-win-3:3" }`

---

## 6. Verification Method

To verify completeness and correctness of the mined specification:
1. Compare data schemas against `/home/ebis/matiks/ORIGINAL_REQUEST.md` to confirm 100% feature coverage across R1–R4.
2. Confirm presence of all 4 specified rule strategy types, seed rule definitions, REST endpoint payload schemas, and Socket.IO pipeline event stage names in `handoff.md`.
