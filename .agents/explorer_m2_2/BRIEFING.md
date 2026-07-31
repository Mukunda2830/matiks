# BRIEFING — 2026-07-31T05:05:30Z

## Mission
Investigate unit testing strategy and exact TypeScript interface contracts for Milestone 2 (Strategy Rule Engine & Deduplication).

## 🔒 My Identity
- Archetype: Teamwork explorer
- Roles: Explorer for Milestone 2
- Working directory: /home/ebis/matiks/.agents/explorer_m2_2
- Original parent: dbaf510a-33f2-4895-861e-8a38d94962da
- Milestone: M2 - Strategy Rule Engine & Deduplication

## 🔒 Key Constraints
- Read-only investigation — do NOT implement production code
- Output handoff report to `/home/ebis/matiks/.agents/explorer_m2_2/handoff.md`

## Current Parent
- Conversation ID: dbaf510a-33f2-4895-861e-8a38d94962da
- Updated: 2026-07-31T05:05:30Z

## Investigation State
- **Explored paths**: `server/src/domain/models.ts`, `server/src/store/KeyValueStore.ts`, `server/src/domain/EventBus.ts`, `server/src/domain/seedRules.ts`, `server/package.json`, `server/test/KeyValueStore.test.ts`
- **Key findings**: Formulated exact TypeScript interface contracts for strategy pattern (`StreakRuleStrategy`, `CountInDayRuleStrategy`, `CountInWindowRuleStrategy`), `RuleIndexer`, `RuleEngine`, and `RewardDispatcher`. Designed comprehensive Vitest test suite plans with 27 specific test cases covering streak tracking, resets on loss, UTC date rollover, 24h TTL, sliding window pruning, wildcard rule indexing, dynamic rule addition, and deduplication locks.
- **Unexplored areas**: Milestone 3 (REST API & Socket.IO WebSockets) contracts.

## Key Decisions Made
- Confirmed Vitest runner baseline (`npm test` passes 59 existing tests).
- Defined standard idempotency key format for strategies:
  - Streak: `${playerId}:${ruleId}:streak:${currentCount}`
  - CountInDay: `${playerId}:${ruleId}:${dateStr}`
  - CountInWindow: `${playerId}:${ruleId}:win_${timeBucket}`
- Formulated exact class interfaces and test suite files under `server/test/engine/`.

## Artifact Index
- `/home/ebis/matiks/.agents/explorer_m2_2/handoff.md` — Handoff report detailing unit testing strategy and exact TS interface contracts for Milestone 2.
