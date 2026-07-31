# Original User Request

## Initial Request — 2026-07-30T23:28:31Z

Build a configurable, event-driven Player Reward Rule Engine demo application with a Node.js/Express/TypeScript backend, in-memory state store (KeyValueStore), WebSocket updates, and a dark-mode Grafana/Datadog-style React dashboard visualizing real-time rule evaluation and pipeline stages.

Working directory: /home/ebis/matiks
Integrity mode: development

---

## Requirements

### R1. Backend Architecture & Domain Core
- Implement an in-memory Redis-like KeyValueStore with TTL expiration, atomic increment, and set operations.
- Implement domain models (MatchCompletedEvent, Rule, RewardTriggeredEvent, PlayerState, LedgerEntry).
- Implement an internal in-memory event bus (MatchCompleted, RewardTriggered, RewardGranted, RewardDeduped).
- Load seed rules at startup:
  1. Win 3 matches in a row -> grant 50 coins (streak)
  2. Play 5 matches in a day -> grant 1 loot box (count_in_day)
  3. Win 2 algebra matches within 1 hour -> activate 2x multiplier for 30 minutes (count_in_window)

### R2. Strategy-based Rule Engine & Indexing
- Implement strategy-based evaluation with StreakRuleStrategy, CountInDayRuleStrategy, and CountInWindowRuleStrategy.
- Implement rule indexing (by result/category) to lookup candidate rules rather than linear scan.
- Deduplicate rewards at the dispatcher stage using TTL-backed idempotency keys (playerId + ruleId + time bucket).

### R3. REST API & WebSocket Real-Time Pipeline
- Expose REST endpoints:
  - POST /api/simulate-match
  - POST /api/simulate-burst
  - GET /api/rules
  - POST /api/rules (dynamic rule addition)
  - GET /api/players/:id/state
  - GET /api/ledger
- Emit Socket.IO events for each stage: MATCH_RECEIVED, RULE_CANDIDATES_FOUND, COUNTERS_UPDATED, THRESHOLD_MET, REWARD_GRANTED, REWARD_DEDUPED.

### R4. Frontend Dashboard
- React + TypeScript + TailwindCSS + Socket.IO client.
- Dark-mode devtools/monitoring aesthetic.
- Include:
  1. Pipeline Visualizer (horizontal animated stage progression < 1s)
  2. Match Simulator (player select, win/loss toggle, category select, single match & burst trigger)
  3. Live Player Counters (streaks, daily count, windowed count, active multipliers)
  4. Color-coded Rule Event Feed
  5. Collapsible Player State Inspector (raw JSON)
  6. Collapsible Rules Config Panel (rule cards + "Add New Rule" form)
  7. System Metrics strip (events processed, rewards granted, rewards deduped, avg eval time, connected clients)
  8. Reward Ledger table (sortable)

### R5. Project Setup & Documentation
- Single root package.json with concurrently script running backend and frontend simultaneously with npm run dev.
- README.md containing Architecture Overview, Scaling Discussion (Kafka/Kinesis, Redis Cluster, etc.), and explicit Interview Talking Points.

---

## Acceptance Criteria

### Backend & Core Logic
- KeyValueStore correctly supports TTL cleanup, atomic increments, and set membership checks.
- Dynamic addition of new rules via POST /api/rules immediately affects rule evaluation without server restart.
- Streak rules reset on LOSS; windowed events expire on read; daily counters handle TTL/date rollover.
- Duplicate triggers produce REWARD_DEDUPED WebSocket event and are not re-entered in the ledger.

### API & Endpoints
- POST /api/simulate-match returns full evaluation trace JSON.
- POST /api/simulate-burst triggers specified N matches with small delays between them.
- GET /api/ledger returns all granted rewards with idempotency keys.

### Frontend Dashboard & Observability
- Visualizer stage boxes highlight in sequence from left to right on event arrival.
- Rule creation form successfully posts new rule to backend and displays updated rule cards.
- Live counter progress bars and active multiplier TTLs update in real-time.

### Build & Verification
- Root npm run dev builds TypeScript and launches backend and frontend without errors.
- Zero dead-letter queues, event replay, or compound rules in implementation (documented in README talking points instead).
