# DISPATCH — test_writer_1

## Task Objective
Create the complete E2E test suite and test infrastructure for the Player Reward Rule Engine project across Tiers 1-4, publish TEST_INFRA.md and TEST_READY.md at project root, and verify all test execution.

## Inputs & Specifications
- Original Request: /home/ebis/matiks/ORIGINAL_REQUEST.md
- Project Spec: /home/ebis/matiks/.agents/orchestrator/PROJECT.md
- Working Directory: /home/ebis/matiks/.agents/test_writer_1
- Target Output Directory for Tests: /home/ebis/matiks/tests
- Root Output Files:
  - /home/ebis/matiks/TEST_INFRA.md
  - /home/ebis/matiks/TEST_READY.md

## Scope & Tier Requirements
1. **TEST_INFRA.md**:
   Create /home/ebis/matiks/TEST_INFRA.md detailing:
   - Test Philosophy (opaque-box, requirement-driven, progressive testability)
   - Feature Inventory & Mapping (F1 to F10 covering R1-R4)
   - Test Architecture & Directory Structure
   - Test Runner Commands & Environment Setup
   - Coverage Goals and Minimum Case Thresholds per Tier

2. **Test Suite Implementation in /home/ebis/matiks/tests**:
   - **Tier 1: Feature Coverage (>=5 test cases per feature across R1-R4)**
     - F1: KeyValueStore (get, set, TTL cleanup, incrBy, sadd, smembers, sismember, srem, scard)
     - F2: Domain Models & EventBus (MatchCompleted, RewardTriggered, RewardGranted, RewardDeduped)
     - F3: Seed Rules (Streak 3 wins -> 50 coins, Daily 5 matches -> 1 lootbox, Window 2 algebra in 1hr -> 2x multiplier for 30m)
     - F4: Rule Strategies (StreakRuleStrategy, CountInDayRuleStrategy, CountInWindowRuleStrategy)
     - F5: Rule Indexer ((category:result) index & wildcard lookups)
     - F6: Idempotency Key Deduplication (playerId + ruleId + timeBucket TTL lock)
     - F7: REST API Endpoints (POST /api/simulate-match, POST /api/simulate-burst, GET /api/rules, POST /api/rules, GET /api/players/:id/state, GET /api/ledger)
     - F8: Socket.IO Real-Time Pipeline (6 stage events)
     - F9: Dynamic Rule Addition (POST /api/rules dynamic evaluation)
     - F10: State Inspector & Metrics Integration
   - **Tier 2: Boundary & Corner Cases (>=5 test cases per feature where applicable)**
     - Resets on LOSS
     - TTL expiration & cleanup
     - Daily count date/midnight rollover
     - Empty inputs & invalid payloads
     - Duplicate trigger collision & time bucket boundary
   - **Tier 3: Cross-Feature Combinations (Pairwise interactions)**
     - Dynamic rule addition + immediate evaluation + deduplication
     - Burst simulation triggering multiple rules (streak + daily count + multiplier)
     - Multi-player interleaved WIN/LOSS events
     - TTL expiration during active stream
     - Concurrent WebSocket event streams
   - **Tier 4: Real-World Application Scenarios (>=5 workload scenarios)**
     - Full Player Journey (5 matches, streak, multiplier, lootbox, state check)
     - Multi-player Tournament Burst (5 players, 20 match burst, metrics & ledger verification)
     - Dynamic Rule Authoring & Pity Mechanism Workflow
     - High Concurrency Burst Evaluation (50 matches in rapid succession)
     - Event Deduplication & Replay Resistance

3. **Verification & TEST_READY.md**:
   - Run the test suite and verify all test cases execute cleanly.
   - Create /home/ebis/matiks/TEST_READY.md with complete tier counts, feature checklist, runner commands, and pass/fail summary.
   - Write handoff report in /home/ebis/matiks/.agents/test_writer_1/handoff.md.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. Integrity violations WILL be detected.
