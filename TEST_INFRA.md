# TEST_INFRA.md — Player Reward Rule Engine Test Infrastructure

## 1. Test Philosophy

The Player Reward Rule Engine test infrastructure is designed around three core principles:

1. **Opaque-Box & Requirement-Driven Specification**:
   Tests treat the domain core, rule strategies, REST endpoints, and WebSocket pipeline as black-box components, verifying behavior strictly against requirements specified in `ORIGINAL_REQUEST.md` (R1-R5) and contract interfaces in `PROJECT.md`.
2. **Progressive Testability & Strict Isolation**:
   Tests are organized in isolated tiers (Tier 1 through Tier 4). Each test case initializes its own state, executes deterministically, and performs clean teardowns (clearing timers, flushing `KeyValueStore`, resetting event listeners). Tests never rely on side effects from prior test executions.
3. **Genuine & Authoritative Output Verification**:
   No facade tests or hardcoded mock assertions. Expected outputs are explicitly derived from the mathematical and state rules defined in `PROJECT.md` (e.g., streak reset on LOSS, windowed time-decay expiration, TTL lock bucket key formatting `dedup:{playerId}:{ruleId}:{bucketId}`).

---

## 2. Feature Inventory & Requirement Mapping (F1 - F10)

| Feature ID | Feature Name | Requirement Mapping | Primary Test Focus |
|------------|--------------|---------------------|-------------------|
| **F1** | KeyValueStore Core | R1, AC-1 | String `get`/`set`/`del`/`ttl`, passive & active TTL expiration, atomic `incrBy`, Set ops (`sadd`, `smembers`, `sismember`, `srem`, `scard`), `flushAll` |
| **F2** | Domain Models & EventBus | R1, R2 | Type models (`MatchCompleted`, `RewardTriggered`, `RewardGranted`, `RewardDeduped`), strongly typed EventEmitter sub/unsub and event payload delivery |
| **F3** | Seed Rules Registration | R1, AC-1 | Verification of initial 3 seed rules: `rule_streak_3_wins` (50 coins), `rule_play_5_daily` (1 lootbox), `rule_win_2_algebra_1hr` (2x multiplier 30m) |
| **F4** | Strategy-based Rule Engine | R2, AC-1 | Evaluation logic of `StreakRuleStrategy`, `CountInDayRuleStrategy`, and `CountInWindowRuleStrategy` across WIN/LOSS/DRAW and category filters |
| **F5** | Category/Result Indexer | R2 | Exact key lookup `category:result`, wildcard category `*:WIN`, wildcard result `algebra:*`, and fallback default indexing |
| **F6** | Idempotency Key Deduplication | R2, AC-4 | Time bucket calculation, `dedup:{playerId}:{ruleId}:{timeBucket}` KeyValueStore TTL lock, suppression of duplicate rewards, emission of `RewardDeduped` |
| **F7** | REST API Endpoints | R3, AC-5 | Endpoints: `POST /api/simulate-match`, `POST /api/simulate-burst`, `GET /api/rules`, `POST /api/rules`, `GET /api/players/:id/state`, `GET /api/ledger` |
| **F8** | Socket.IO Real-Time Pipeline | R3, R4 | Emitting sequential events for 6 pipeline stages: `MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, `COUNTERS_UPDATED`, `THRESHOLD_MET`, `REWARD_GRANTED`, `REWARD_DEDUPED` |
| **F9** | Dynamic Rule Addition | R3, AC-2 | Immediate active evaluation of new rules created via `POST /api/rules` without server restart |
| **F10** | State Inspector & System Metrics | R4, AC-3 | Player inventory counters (`coins`, `lootBoxes`), active multiplier TTL countdowns, total events processed, rewards granted, rewards deduped |

---

## 3. Test Architecture & Directory Structure

```
tests/
├── harness/
│   ├── TestEngineHarness.ts       # Self-contained testing harness powering unit & E2E evaluations
│   └── mockData.ts               # Minimal test fixtures & match generators
├── tier1/                        # Feature Coverage (>=5 tests per feature, total >=50 tests)
│   ├── f1_keyvaluestore.test.ts
│   ├── f2_domain_models.test.ts
│   ├── f3_seed_rules.test.ts
│   ├── f4_rule_strategies.test.ts
│   ├── f5_rule_indexer.test.ts
│   ├── f6_idempotency_dedup.test.ts
│   ├── f7_rest_api.test.ts
│   ├── f8_websocket_pipeline.test.ts
│   ├── f9_dynamic_rules.test.ts
│   └── f10_state_metrics.test.ts
├── tier2/                        # Boundary & Corner Cases (>=25 tests)
│   └── boundary_corner_cases.test.ts
├── tier3/                        # Cross-Feature Combinations (>=15 tests)
│   └── cross_feature_combinations.test.ts
├── tier4/                        # Real-World Application Scenarios (>=10 tests)
│   └── real_world_scenarios.test.ts
└── run_all.ts                    # Suite execution script & consolidated report generator
```

---

## 4. Test Tiers & Minimum Case Thresholds

| Tier | Name | Target Coverage & Scope | Minimum Test Cases |
|------|------|-------------------------|-------------------|
| **Tier 1** | Feature Coverage | Isolated functional tests for features F1 through F10 | **>= 50 cases** (>=5 per feature) |
| **Tier 2** | Boundary & Corner Cases | Streak resets on LOSS, TTL expiration, date/midnight rollover, empty inputs, idempotency collision | **>= 25 cases** |
| **Tier 3** | Cross-Feature Combinations | Pairwise feature interactions (dynamic rule + eval + dedup, burst simulation multi-rule, interleaved events) | **>= 15 cases** |
| **Tier 4** | Real-World Workload Scenarios | Full player journey, multi-player tournament burst, dynamic pity rule authoring, 50-match high concurrency, replay resistance | **>= 10 scenarios** |

**Total Suite Minimum Threshold**: **>= 100 tests**.

---

## 5. Test Runner Commands & Environment Setup

### Environment Requirements
- **Node.js**: `v20+` or `v26.4+` (Native TypeScript execution enabled via `--experimental-strip-types`).
- **Dependencies**: `express`, `socket.io`, `uuid` (installed in `/home/ebis/matiks/server`).

### Execution Commands

1. **Run All Tests (Native Node Runner)**:
   ```bash
   node --experimental-strip-types --test tests/tier1/*.test.ts tests/tier2/*.test.ts tests/tier3/*.test.ts tests/tier4/*.test.ts
   ```

2. **Run All Tiers via Custom Report Generator**:
   ```bash
   node --experimental-strip-types tests/run_all.ts
   ```

3. **Run Specific Test Tier**:
   ```bash
   # Tier 1 only
   node --experimental-strip-types --test tests/tier1/*.test.ts

   # Tier 2 only
   node --experimental-strip-types --test tests/tier2/*.test.ts

   # Tier 3 only
   node --experimental-strip-types --test tests/tier3/*.test.ts

   # Tier 4 only
   node --experimental-strip-types --test tests/tier4/*.test.ts
   ```

---

## 6. Verification Criteria
- All tests execute synchronously or asynchronously without unhandled promise rejections.
- Zero open handles or background timer leaks upon completion (`store.flushAll()` called in teardowns).
- 100% pass rate across all 4 tiers.
