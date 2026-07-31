# Orchestrator Plan — Player Reward Rule Engine

## High-Level Objective
Build and verify a production-grade, event-driven Player Reward Rule Engine demo application with a Node.js/Express/TypeScript backend, in-memory KeyValueStore, Socket.IO WebSocket updates, and a dark-mode Grafana/Datadog-style React dashboard.

## Orchestration Strategy: Project Pattern
1. **Phase 0: Survey & Requirements Mapping**
   - Dispatch 3 `teamwork_preview_explorer` / `teamwork_preview_spec_miner` subagents to investigate project root, dependencies, domain rules, and requirements.
   - Aggregate reports into `PROJECT.md` (Feature Inventory, Architecture, Interface Contracts, Code Layout).
2. **Phase 1: Dual Track Initiation**
   - Track A: E2E Testing Suite Track (`TEST_INFRA.md` -> test harness, runners, Tiers 1-4 test cases -> `TEST_READY.md`).
   - Track B: Core Implementation Milestones.
     - M1: Backend Foundation & KeyValueStore + Event Bus + Domain Core
     - M2: Strategy Rule Engine & Deduplication Engine
     - M3: REST API & WebSockets Real-Time Pipeline
     - M4: React + Tailwind Frontend Dashboard & Observability Components
     - M5: Root Setup, Concurrently, Documentation (README with scaling & interview talking points)
3. **Phase 2: Milestone Iteration Loops (Explorer -> Worker -> Reviewer -> Challenger -> Auditor)**
   - Execute milestone implementation cycles with strict verification.
4. **Phase 3: E2E Final Pass & Adversarial Hardening (Tier 5)**
   - Run 100% E2E test verification.
   - Run Tier 5 Adversarial Coverage Hardening loop.
5. **Phase 4: Synthesis & Final Verification & Handoff**
