# Matiks — Player Reward Rule Engine

A configurable, event-driven reward platform demo built for a technical interview.
Demonstrates clean architecture, config-driven rules, real-time observability, and
idempotent reward dispatch — end-to-end, running live.

---

## Quick Start

```bash
npm install          # installs root devDependencies (concurrently)
npm run install:all  # installs backend + frontend packages
npm run dev          # starts both servers concurrently
```

- **Backend** → http://localhost:3001
- **Frontend dashboard** → http://localhost:5173

---

## Architecture Overview

### Event-Driven Design

The system processes match events through a linear pipeline. Each stage is discrete and emits
an internal event when complete. This mirrors how production systems like Kafka would partition
work across services — each box in the pipeline could become an independent microservice
consuming from a topic.

```
Match Event
    ↓
Rule Engine (index lookup → strategy evaluation)
    ↓
Player State Store (counters: streaks, daily counts, windowed events)
    ↓
Reward Dispatcher (idempotency check → ledger write)
    ↓
EventBus (RewardGranted / RewardDeduped)
    ↓
Socket.IO (real-time WebSocket broadcast)
    ↓
Frontend Dashboard (live pipeline visualization)
```

### Config-Driven Rules

Rules are plain JSON objects loaded from a config array at startup. The rule evaluation engine
contains **no hardcoded conditionals** — it looks up which strategy class handles a given
`triggerType` (via a Map), then delegates evaluation entirely to that strategy.

Adding a new rule at runtime via `POST /api/rules` immediately affects the next match event:
the rule is indexed and evaluated without any code changes or server restart.

### Strategy Pattern

The rule engine uses a **strategy per trigger type**:

| Strategy | Trigger Type | How it works |
|---|---|---|
| `StreakRuleStrategy` | `STREAK` | Increments a per-rule streak counter; resets on LOSS |
| `CountInDayRuleStrategy` | `COUNT_IN_DAY` | TTL-backed daily counter keyed by date string |
| `CountInWindowRuleStrategy` | `COUNT_IN_WINDOW` | Set of timestamped events; expired entries pruned on read |

New trigger types can be added by implementing `RuleStrategy` and registering it in the engine's
strategy map — no changes to evaluation flow.

### Rule Indexing

Instead of evaluating every active rule for every event (O(N) per event), rules are indexed
at registration time by `{category}:{resultFilter}`. On each match event, the engine looks
up only the candidate rules for that specific category/result combination — making evaluation
O(candidates) rather than O(total rules), which matters as rule counts grow.

### Idempotent Reward Dispatch

The `RewardDispatcher` uses a **TTL-backed deduplication set** (our in-memory `KeyValueStore`)
keyed by `idempotencyKey = playerId + ruleId + timeBucket`. Before writing a reward to the
ledger, it atomically checks this key. If it already exists, the event is recorded as `DEDUPED`
and no reward is granted — preventing double-grants even if a trigger fires multiple times within
the same time window.

### KeyValueStore

A self-contained in-memory store with:
- **TTL support**: Active timers + passive expiry checks on every access
- **Atomic increments**: `incrBy()` reads, modifies, and writes in-process (no race conditions in single-threaded Node.js)
- **Set storage**: Used for windowed event deduplication and idempotency tracking

---

## API Reference

```http
POST /api/simulate-match
  Body: { playerId, result: "WIN"|"LOSS", category: "algebra"|"speed"|"general" }
  Returns: full evaluation trace with execution time

POST /api/simulate-burst
  Body: { playerId, count, result?, category? }
  Returns: queued confirmation; matches fire async with 200ms spacing

GET  /api/rules
POST /api/rules
  Body: { name, type, targetCount, reward, category?, resultFilter?, windowSeconds? }
  Effect: immediately indexed; no restart

GET  /api/players/:id/state
GET  /api/ledger
GET  /api/metrics
```

---

## Scaling Discussion

> This section describes production evolution — none of this is implemented in the demo.

### Millions of Concurrent Users

**Event ingestion** — Replace the HTTP POST with a Kafka/Kinesis topic, partitioned by
`playerId`. This guarantees ordered processing per player and allows horizontal fan-out to
evaluation workers.

**Stateless evaluation workers** — Rule evaluation is a pure function of (event, rule config,
player counter snapshot). Workers can be scaled horizontally; each worker fetches its player's
counters, evaluates, and writes results back atomically.

**Sharded counters** — Replace `KeyValueStore` with Redis Cluster, using hash tags on
`playerId` to ensure all of a player's keys land on the same shard. This keeps counter reads
and atomic increments local to a single Redis node.

**Idempotency store** — Backed by a distributed cache (Redis Cluster or DynamoDB conditional
writes) instead of in-process memory. This ensures deduplication holds across horizontally
scaled dispatcher instances.

**Reward ledger** — A transactional database (PostgreSQL or DynamoDB with strong consistency)
becomes the system of record. The ledger write and idempotency key set are wrapped in a
distributed transaction or optimistic locking pattern.

**Rule config distribution** — Rules are stored in a central config store (e.g., S3 + Lambda,
or a database with cache-aside). Workers cache rule sets locally and receive invalidation
events when rules are added or modified.

---

## Interview Talking Points

### 1. Why are rules config-driven, not hardcoded?

Hardcoding rules means every product change requires a code review, deployment, and regression
testing cycle. Rules as data means the product team can add, modify, or disable rules through
a config API with no engineering involvement — and no risk of shipping broken evaluation logic
alongside a product change. It also makes the system testable: you can assert rule behavior
from the config object alone, without reading business logic out of if-else chains.

### 2. Why does rule indexing matter?

Without indexing, every incoming event scans all N active rules. At 1,000 rules and 10,000
events/second, that's 10 million comparisons/second — wasted CPU on rules that could never
match a WIN event, or rules filtered to a different category. The index reduces candidates to
only the rules whose `{category, resultFilter}` signature matches the incoming event. As rule
count grows, evaluation time stays nearly constant — the cost is bounded by matching rules, not
total rules.

### 3. Why is idempotency required specifically at reward dispatch?

The reward trigger is the one stage where **side effects are permanent** — coins are added to
a player's account, loot boxes appear in their inventory. All earlier stages (counter increments,
threshold checks) are cheap and reversible. But a double-granted reward is a financial ledger
error. The idempotency check at the final dispatch step ensures that no matter how many times
the same trigger arrives (network retries, event replay, duplicate delivery from Kafka), the
reward is written exactly once.

### 4. Why does event-driven design scale better than polling?

Polling-based approaches (e.g., a cron job that scans player counters every minute) have two
problems: latency (rewards fire at batch boundaries, not at the moment they're earned) and
waste (you scan all players even when 99% have no new activity). Event-driven design fires
evaluation **only when something happens** — zero wasted work, sub-second latency, and the
work scales linearly with actual activity rather than player count.

### 5. How would this handle millions of concurrent users?

Partition the Kafka topic by `playerId` — each partition is a single-threaded ordered queue,
so all events for a given player are processed in order. Stateless evaluation workers consume
from partitions and fetch player counters from Redis (sharded by playerId hash tag for locality).
Horizontal scale is achieved by adding more workers and more partitions; no coordination between
workers is needed because players are isolated. The idempotency store (Redis or DynamoDB) is
the only shared state, and it's accessed atomically.

### 6. What was deliberately left out of this demo?

- **Dead-letter queues** — important for production reliability but add infrastructure and failure
  mode complexity that obscures the core pattern in a demo.
- **Event replay** — replaying historical events to recompute player state is a valuable
  production feature (e.g., retroactive rule application) but requires durable event storage and
  replay ordering semantics — too much setup for a live demo.
- **Load-testing endpoints** — a `/load-test` endpoint would add fragility and create the impression
  that this is a benchmarking demo rather than an architecture demo.
- **Rule versioning / cooldowns** — valid production concerns but rule versions require a migration
  strategy for existing counters, and cooldowns require additional TTL-keyed state — neither
  adds architectural clarity in a demo context.

The goal of scoping deliberately is to demonstrate that you can reason about what adds value to
an audience versus what adds risk — a key engineering judgment call.
