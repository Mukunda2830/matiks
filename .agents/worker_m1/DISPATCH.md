## 2026-07-31T00:00:00Z
You are the Worker for Milestone 1 (Domain Core & KeyValueStore).
Original Request: /home/ebis/matiks/ORIGINAL_REQUEST.md
Scope Document: /home/ebis/matiks/.agents/orchestrator/PROJECT.md
Explorer Handoffs:
- /home/ebis/matiks/.agents/explorer_m1_1/handoff.md
- /home/ebis/matiks/.agents/explorer_m1_2/handoff.md
Working Directory: /home/ebis/matiks/.agents/worker_m1

Write Ownership: You have exclusive write ownership of `server/` (creating `server/package.json`, `server/tsconfig.json`, `server/src/store/KeyValueStore.ts`, `server/src/domain/models.ts`, `server/src/domain/EventBus.ts`, `server/src/domain/seedRules.ts`, and `server/test/` unit tests).

Tasks:
1. Initialize server workspace (`server/package.json` with dependencies like express, socket.io, uuid, typescript, tsx, vitest, `server/tsconfig.json`). Install dependencies and set up build & test scripts.
2. Implement KeyValueStore in `server/src/store/KeyValueStore.ts` with dual passive (on-read) and active (timer) TTL expiration, atomic `incrBy`, and set operations (`sAdd`, `sMembers`, `sIsMember`, `sRem`, `sCard`, `flushAll`). Call `timerId.unref()` on active timers.
3. Implement domain models in `server/src/domain/models.ts` (`MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`, `ActiveMultiplier`).
4. Implement strongly typed event bus in `server/src/domain/EventBus.ts` for channels (`MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`).
5. Implement seed rules initializer in `server/src/domain/seedRules.ts` with the 3 required seed rules (streak 3 wins -> 50 coins, play 5/day -> 1 loot box, win 2 algebra in 1hr -> 2x multiplier for 30m).
6. Create comprehensive unit tests in `server/test/` testing KeyValueStore TTL expiration, atomic increments, set operations, EventBus pub-sub, and seed rules loading. Run `npm test` and `npm run build` to verify clean compilation and 100% test pass.
7. Write your handoff report to /home/ebis/matiks/.agents/worker_m1/handoff.md with full command logs and build/test results.
