# Project: Player Reward Rule Engine

## Architecture
- Backend: Node.js + Express + TypeScript + Socket.IO server.
- State Store: In-memory Redis-like KeyValueStore (passive + active TTL, atomic increment, set operations).
- Domain Core: Event-driven architecture with internal pub-sub Event Bus (`MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`).
- Strategy Rule Engine: Strategy pattern (`StreakRuleStrategy`, `CountInDayRuleStrategy`, `CountInWindowRuleStrategy`) with `(category:result)` indexing for O(1) candidate lookup and TTL-backed idempotency deduplication key locks.
- Frontend: React + TypeScript + Vite + TailwindCSS + Socket.IO client (dark-mode monitoring dashboard aesthetic).
- Real-Time Observability: 6 WebSocket stage emissions powering horizontal visualizer pipeline (<1s animation), live player counters & multiplier TTL timers, color-coded event feed, raw player state JSON inspector, rules card config panel + dynamic rule creation form, system metrics strip, and sortable reward ledger table.
- Setup & Infra: Root package.json with `concurrently` script running backend and frontend simultaneously via `npm run dev`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | KeyValueStore Core | In-memory key-value store with passive/active TTL cleanup, atomic `incrBy`, set ops (`sadd`, `smembers`, `sismember`, `srem`, `scard`) | M1 | Survey |
| 2 | Domain Models & Event Bus | Domain models (`MatchCompletedEvent`, `Rule`, `RewardTriggeredEvent`, `PlayerState`, `LedgerEntry`), in-memory pub-sub event bus | M1 | Survey |
| 3 | Seed Rules Registration | Startup registration of 3 seed rules (streak 3 wins -> 50 coins, play 5/day -> 1 loot box, win 2 algebra in 1hr -> 2x multiplier for 30m) | M1 | Survey |
| 4 | Strategy-based Evaluation Engine | `StreakRuleStrategy`, `CountInDayRuleStrategy`, `CountInWindowRuleStrategy` strategy implementations | M2 | Survey |
| 5 | Category/Result Rule Indexing | Composite index `(category:result)` + wildcard matching for O(1) candidate retrieval | M2 | Survey |
| 6 | Idempotency Key Deduplication | Dispatcher TTL lock (`playerId + ruleId + timeBucket`) in KeyValueStore with `REWARD_GRANTED` / `REWARD_DEDUPED` events | M2 | Survey |
| 7 | Express REST API | Endpoints `POST /api/simulate-match`, `POST /api/simulate-burst`, `GET /api/rules`, `POST /api/rules`, `GET /api/players/:id/state`, `GET /api/ledger` | M3 | Survey |
| 8 | Socket.IO Real-Time Pipeline | Emit Socket.IO events for 6 pipeline stages (`MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, `COUNTERS_UPDATED`, `THRESHOLD_MET`, `REWARD_GRANTED`, `REWARD_DEDUPED`) | M3 | Survey |
| 9 | React + Tailwind Dashboard App & Layout | Dark-mode Grafana/Datadog aesthetic monitoring grid layout with Socket.IO client manager & connection status | M4 | Survey |
| 10 | Pipeline Visualizer Component | Horizontal stage progression box pipeline with <1s sequential pulse animation | M4 | Survey |
| 11 | Match Simulator Component | Interactive controls for single match and burst simulation with player, result, category, count, delay controls | M4 | Survey |
| 12 | Live Player Counters & Multiplier Timers | Streak, daily count, windowed count, active multiplier cards with live TTL countdown progress bars | M4 | Survey |
| 13 | Color-coded Rule Event Feed | Scrollable live timeline of pipeline events color-coded by event stage with payload details | M4 | Survey |
| 14 | Collapsible State & Config Panels | Collapsible Player State Inspector (raw JSON) and Rules Config Panel (rule cards + dynamic rule creation form) | M4 | Survey |
| 15 | System Metrics & Sortable Reward Ledger | Top sticky system metrics strip and sortable reward ledger data table | M4 | Survey |
| 16 | Root Concurrently Setup & Script | Single root package.json with `concurrently` running backend & frontend via `npm run dev` | M5 | Survey |
| 17 | Project Documentation & Talking Points | `README.md` with Architecture Overview, Scaling Discussion (Kafka/Kinesis, Redis Cluster, partition keying, idempotency), and explicit Interview Talking Points (architectural justification for omitting DLQ, event replay, compound rules) | M5 | Survey |

## Code Layout
```
/home/ebis/matiks/
├── package.json
├── README.md
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── store/
│       │   └── KeyValueStore.ts
│       ├── domain/
│       │   ├── models.ts
│       │   └── EventBus.ts
│       ├── engine/
│       │   ├── strategies/
│       │   │   ├── RuleStrategy.ts
│       │   │   ├── StreakRuleStrategy.ts
│       │   │   ├── CountInDayRuleStrategy.ts
│       │   │   └── CountInWindowRuleStrategy.ts
│       │   ├── RuleIndexer.ts
│       │   ├── RuleEngine.ts
│       │   └── RewardDispatcher.ts
│       ├── api/
│       │   ├── routes.ts
│       │   └── controllers.ts
│       └── websocket/
│           └── pipelineSocket.ts
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── types.ts
        ├── services/
        │   ├── api.ts
        │   └── socket.ts
        └── components/
            ├── NavbarHeader.tsx
            ├── SystemMetricsStrip.tsx
            ├── PipelineVisualizer.tsx
            ├── MatchSimulator.tsx
            ├── LivePlayerCounters.tsx
            ├── EventFeed.tsx
            ├── RewardLedger.tsx
            ├── RulesConfigPanel.tsx
            └── PlayerStateInspector.tsx
```

## Interface Contracts

### KeyValueStore ↔ Rule Engine / Dispatcher
- `get(key: string): Promise<string | null>`
- `set(key: string, value: string, ttlSeconds?: number): Promise<boolean>`
- `incrBy(key: string, amount: number, ttlSeconds?: number): Promise<number>`
- `sAdd(key: string, member: string): Promise<boolean>`
- `sMembers(key: string): Promise<string[]>`

### Rule Engine ↔ REST API / Event Bus
- `evaluateMatch(event: MatchCompletedEvent): Promise<EvaluationTrace>`
- `registerRule(rule: Rule): void`
- `getCandidateRules(category: string, result: string): Rule[]`

### Backend REST & Socket.IO ↔ Frontend React Client
- HTTP POST `/api/simulate-match` -> returns `{ success, matchEvent, evaluatedRules, triggeredRewards, trace }`
- HTTP POST `/api/simulate-burst` -> returns `{ success, processedMatches, totalRewardsGranted, totalRewardsDeduped }`
- HTTP GET `/api/rules` -> returns `Rule[]`
- HTTP POST `/api/rules` -> returns `Rule`
- HTTP GET `/api/players/:id/state` -> returns `PlayerState`
- HTTP GET `/api/ledger` -> returns `LedgerEntry[]`
- Socket.IO Events: `MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, `COUNTERS_UPDATED`, `THRESHOLD_MET`, `REWARD_GRANTED`, `REWARD_DEDUPED`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Domain Core & KeyValueStore | KeyValueStore, Domain Models, Event Bus, Seed Rules | none | DONE |
| M2 | Strategy Rule Engine & Deduplication | Rule strategies, Rule indexer, Idempotency lock dispatcher | M1 | IN_PROGRESS |
| M3 | REST API & WebSockets Backend | Express API endpoints, Socket.IO real-time pipeline events | M2 | PLANNED |
| M4 | Frontend React + Tailwind Dashboard | Socket.IO client, 8 core UI components (Visualizer, Simulator, Counters, Feed, Inspector, Rules Panel, Metrics, Ledger) | M3 | PLANNED |
| M5 | Root Setup, Concurrently & README | Root package.json, `npm run dev`, README scaling & talking points | M4 | PLANNED |
