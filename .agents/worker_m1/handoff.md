# Handoff Report — Worker M1 (Domain Core & KeyValueStore)

## 1. Observation

1. **Workspace Files Created**:
   - `server/package.json`: Server package manifest with scripts (`build: "tsc"`, `test: "vitest run"`), dependencies (`express`, `socket.io`, `uuid`), and devDependencies (`typescript`, `tsx`, `@types/node`, `@types/express`, `@types/uuid`, `vitest`).
   - `server/tsconfig.json`: TypeScript configuration (target `ES2022`, module `CommonJS`, strict mode enabled, output to `./dist`).
   - `server/src/domain/models.ts`: Domain Core interfaces (`MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`, `RewardConfig`, `ActiveMultiplier`, `MatchResult`, `RuleType`, `RewardType`).
   - `server/src/store/KeyValueStore.ts`: In-memory Redis-like KeyValueStore with dual passive (on-read) and active (`setTimeout` with `.unref()`) TTL expiration, atomic `incrBy`, set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`), key existence (`exists`), TTL inspection (`ttl`), key deletion (`del`), and teardown (`flushAll`).
   - `server/src/domain/EventBus.ts`: Strongly-typed in-memory pub-sub EventBus wrapping `EventEmitter` for channels `MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`.
   - `server/src/domain/seedRules.ts`: Startup seed rules initializer returning the 3 required seed rules (`rule_streak_3_wins`, `rule_play_5_daily`, `rule_win_2_algebra_1hr`).
   - `server/test/KeyValueStore.test.ts`: 20 unit tests covering basic CRUD, passive on-read TTL expiration, active timer TTL expiration, timer overwrites, atomic increments, set operations, and `flushAll`.
   - `server/test/EventBus.test.ts`: 5 unit tests covering event publishing, listener registration, `once`, `off`, and `removeAllListeners`.
   - `server/test/seedRules.test.ts`: 5 unit tests verifying all 3 seed rules' attributes and immutability of seed rules array clones.

2. **Execution Results**:
   - `npm test`:
     ```text
     Test Files  3 passed (3)
          Tests  30 passed (30)
       Start at  05:02:16
       Duration  4.32s
     ```
   - `npm run build`:
     ```text
     npm notice run matiks-server@1.0.0 build
     npm notice run tsc
     ```
     Exit code: 0 (Clean TypeScript build, generated output in `server/dist/`).

---

## 2. Logic Chain

1. **KeyValueStore Dual TTL & Memory Safety**:
   - **Passive Expiry**: On every read/write call (`get`, `exists`, `sMembers`, `sIsMember`, `incrBy`, `sAdd`, etc.), `checkPassiveExpiry(key)` is invoked. If `Date.now() >= expiresAt`, `delInternal(key)` is called immediately and `null`/`false`/`0` is returned.
   - **Active Expiry**: `setTTL(key, ttlSeconds)` schedules `setTimeout(() => this.delInternal(key), ttlSeconds * 1000)` and calls `timerId.unref()` so background timers do not keep the Node event loop alive or block test runners.
   - **Timer Teardown**: When keys are updated, overwritten, deleted, or cleared via `flushAll()`, active timers are explicitly cancelled via `clearTimeout(timerId)`.

2. **Atomic Increments & Set Operations**:
   - `incrBy(key, amount, ttlSeconds?)`: Safely parses numeric string values (defaulting missing or invalid values to `0`), atomically increments by `amount`, updates key value, and refreshes or sets TTL if provided.
   - Set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`): Operates on native JavaScript `Set<string>`. `sAdd` accepts single string or array of strings and returns newly added count. `sRem` removes members and automatically deletes key entry when set becomes empty.

3. **EventBus Strong Typing**:
   - `EventBus` defines strict `EventMap` type mapping:
     - `MatchCompleted` -> `MatchCompletedEvent`
     - `RewardTriggered` -> `RewardTriggeredEvent`
     - `RewardGranted` -> `{ ledgerEntry: LedgerEntry; playerState: PlayerState }`
     - `RewardDeduped` -> `{ playerId: string; ruleId: string; idempotencyKey: string; timestamp: number }`
   - Wrapper methods (`on`, `once`, `off`, `emit`, `removeAllListeners`) enforce complete type safety at compile-time.

4. **Seed Rules Registration**:
   - `SEED_RULES` defines 3 initial rules matching specs:
     1. `rule_streak_3_wins`: STREAK target 3 WIN -> 50 COINS
     2. `rule_play_5_daily`: COUNT_IN_DAY target 5 -> 1 LOOT_BOX
     3. `rule_win_2_algebra_1hr`: COUNT_IN_WINDOW target 2 algebra WIN (window 3600s) -> 2x MULTIPLIER (duration 1800s)
   - `getSeedRules()` returns deep clones to prevent accidental mutation of global seed definitions.

---

## 3. Caveats

- **Scope Boundary**: Milestone 1 is strictly restricted to `server/` core domain models, KeyValueStore, EventBus, seed rules, and unit tests. Rule evaluation strategies, rule indexing, idempotency lock dispatcher, REST API routes, and Socket.IO real-time emitters will be built in subsequent Milestones (M2-M4).
- **Time Precision**: Active TTL timer callbacks depend on Node.js `setTimeout` resolution. Passive on-read expiration guarantees immediate exact-millisecond invalidation regardless of timer tick skew.

---

## 4. Conclusion

Milestone 1 is completely implemented, cleanly compiled, fully tested (30/30 tests passing), and ready for Milestone 2 (Strategy Rule Engine & Deduplication).

---

## 5. Verification Method

To verify the implementation independently:

1. **Run Unit Test Suite**:
   ```bash
   cd /home/ebis/matiks/server
   npm test
   ```
   *Expected Result*: All 30 unit tests across `KeyValueStore.test.ts`, `EventBus.test.ts`, and `seedRules.test.ts` pass with 0 errors.

2. **Run TypeScript Compiler**:
   ```bash
   cd /home/ebis/matiks/server
   npm run build
   ```
   *Expected Result*: Exits with code 0 and emits compiled `.js` and `.d.ts` declaration files in `server/dist/`.
