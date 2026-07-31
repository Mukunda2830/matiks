# Specification Mining Report — Frontend Dashboard, UI/UX, Root Setup & Test Scenarios

## 1. Observation
The requirements are mined directly from `/home/ebis/matiks/ORIGINAL_REQUEST.md`. Key statements extracted:

1. **Dashboard Architecture & Tech Stack**:
   - React + TypeScript + TailwindCSS + Socket.IO client (Line 39).
   - Aesthetic: Dark-mode devtools / monitoring dashboard (Grafana/Datadog style) visualizing real-time rule evaluation and pipeline stages (Lines 5, 40).
2. **Dashboard UI Components (8 Core Modules)**:
   - **Pipeline Visualizer**: Horizontal animated stage progression completing under 1 second (< 1s). Stage boxes highlight sequentially from left to right on event arrival across pipeline stages (`MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, `COUNTERS_UPDATED`, `THRESHOLD_MET`, `REWARD_GRANTED` / `REWARD_DEDUPED`) (Lines 42, 71).
   - **Match Simulator**: Interactive control panel with player selection, win/loss toggle, category selection (e.g. algebra, trivia), single match trigger button (`POST /api/simulate-match`), and burst simulation trigger (`POST /api/simulate-burst` with match count N and batch delay) (Lines 43, 66, 67).
   - **Live Player Counters**: Real-time display for player counters: Win Streaks, Daily Count, Windowed Count (e.g. algebra matches in last 1 hour), and Active Multipliers (e.g. 2x multiplier with active countdown timer/TTL progress bar) (Lines 44, 73).
   - **Color-coded Rule Event Feed**: Live scrollable event feed, color-coded by event type (e.g. green for REWARD_GRANTED, amber/yellow for REWARD_DEDUPED, blue for MATCH_RECEIVED, purple for THRESHOLD_MET) with timestamp, player ID, and payload details (Line 45).
   - **Collapsible Player State Inspector**: Collapsible drawer/card displaying formatted raw JSON of the active player's state fetched from `GET /api/players/:id/state` or pushed via WebSocket updates (Line 46).
   - **Collapsible Rules Config Panel**: Collapsible panel containing active rule cards (ID, strategy type, condition specs, reward payload, TTL/window) and an "Add New Rule" form. Submitting the form posts to `POST /api/rules`, dynamically adding the rule backend-side without server restart and updating displayed rule cards (Lines 47, 61, 72).
   - **System Metrics Strip**: Top/sticky metrics header displaying real-time aggregated counters: Total Events Processed, Rewards Granted, Rewards Deduped, Average Evaluation Time (ms), and Connected WebSocket Clients (Line 48).
   - **Reward Ledger Table**: Table displaying all granted rewards (`GET /api/ledger`). Includes columns: Timestamp, Player ID, Rule ID, Reward Type/Amount, Idempotency Key. Columns must be sortable (Lines 49, 68).
3. **Root Build & Concurrently Developer Setup**:
   - Single root `package.json` with a `concurrently` script executing backend and frontend concurrently via `npm run dev` (Line 52).
   - Root `npm run dev` compiles TypeScript and launches backend and frontend without errors (Line 76).
4. **Documentation & Talking Points**:
   - `README.md` containing Architecture Overview, Scaling Discussion (Kafka/Kinesis streams, Redis Cluster, partition keys by playerId, idempotency storage at scale), and explicit Interview Talking Points (Line 53).
   - Explicit architectural scope constraint: Zero dead-letter queues (DLQ), event replay, or compound rules in current implementation, with architectural justification documented in README talking points instead (Lines 53, 77).

---

## 2. Logic Chain
1. **Frontend State & Real-Time Sync**:
   - When a match is triggered via Match Simulator (single or burst), HTTP request is sent to Express REST API.
   - Express pipeline emits Socket.IO events sequentially: `MATCH_RECEIVED` -> `RULE_CANDIDATES_FOUND` -> `COUNTERS_UPDATED` -> `THRESHOLD_MET` -> `REWARD_GRANTED` (or `REWARD_DEDUPED`).
   - Frontend Socket.IO listener updates:
     - Pipeline Visualizer active stage index and pulse animation.
     - Live Player Counters state and multiplier TTL timers.
     - Color-coded Rule Event Feed log entries (prepended with unique ID & timestamp).
     - System Metrics strip counters (events++, granted++, deduped++, avg latency recalculated).
     - Reward Ledger table entries (when `REWARD_GRANTED` arrives).
     - Player State Inspector JSON tree.
2. **Dark-Mode Monitoring UI Layout**:
   - Header: App Title, Connection Status Indicator (connected/disconnected badge), System Metrics Strip.
   - Main Grid Column 1: Match Simulator, Pipeline Visualizer, Live Player Counters.
   - Main Grid Column 2: Color-Coded Event Feed, Reward Ledger Table.
   - Bottom / Expandable Sections: Collapsible Rules Config Panel (Cards + Form), Collapsible Player State Inspector.
3. **Form Handling & Dynamic Rule Mutation**:
   - Rule form input validated for strategy type (`streak`, `count_in_day`, `count_in_window`), target result/category, count threshold, reward type & amount, and window/TTL seconds.
   - POST to `/api/rules` updates backend rule index immediately. Response triggers frontend list refresh (`GET /api/rules` or direct state update).

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Dashboard Architecture | Socket.IO Client Manager | Manages WebSocket connection to backend with auto-reconnect, connection state badge (Online/Offline), and event listeners for all 6 pipeline events. | Server WebSocket URL (`ws://localhost:3000`) | Socket connection state, live event payload dispatch | Displays fallback warning badge on disconnect, attempts exponential backoff reconnection. | ORIGINAL_REQUEST.md (L36, L39, L48) |
| 2 | Dashboard Architecture | Dark-Mode Grafana/Datadog Theme | High-density dark aesthetic (slate/zinc background, glowing indicators, monospace metrics, color badges). | TailwindCSS dark mode classes, theme tokens | Responsive dark themed dashboard grid | Fallback to default dark slate styling if system prefers light mode. | ORIGINAL_REQUEST.md (L5, L40) |
| 3 | Pipeline Visualizer | Stage Progression Visualizer | Horizontal stage box pipeline (`MATCH_RECEIVED` -> `RULE_CANDIDATES_FOUND` -> `COUNTERS_UPDATED` -> `THRESHOLD_MET` -> `REWARD_GRANTED` / `REWARD_DEDUPED`) with sequential glow animations completing in <1s. | Socket.IO pipeline events (`MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, etc.) | Animated stage highlights, step timer indicators | Reset highlight state on idle timeout or error event. | ORIGINAL_REQUEST.md (L42, L71) |
| 4 | Match Simulator | Single Match Trigger | Form controls to select player (`player1`, `player2`), win/loss toggle, category (`algebra`, `trivia`, `battle_royale`), and button to submit `POST /api/simulate-match`. | Player ID, Result (WIN/LOSS), Category | HTTP POST request to API, triggers backend pipeline & Socket.IO events | Show error toast/alert if API call fails or returns 500. | ORIGINAL_REQUEST.md (L30, L43, L66) |
| 5 | Match Simulator | Burst Match Simulator | Control inputs for match count N (e.g. 5, 10, 20) and delay between matches, with "Simulate Burst" button calling `POST /api/simulate-burst`. | Count N, Delay (ms), Player ID, Category, Win/Loss ratio | HTTP POST request to `/api/simulate-burst`, triggers burst sequence | Validate N > 0; disable button while burst is in progress. | ORIGINAL_REQUEST.md (L31, L43, L67) |
| 6 | Live Player Counters | Streak & Daily Count Display | Live updating card displaying selected player's current win streak and daily match count with progress indicators toward next rule thresholds. | WebSocket `COUNTERS_UPDATED` event, Player State | Visual counter cards, streak flame icon, daily count progress bar | Gracefully handle missing or reset counters (render 0). | ORIGINAL_REQUEST.md (L44, L73) |
| 7 | Live Player Counters | Windowed Count & Multiplier Countdown | Displays windowed match count (e.g. algebra matches in 1hr) and active multiplier countdown timer (e.g., 2x multiplier for 30m) with live decreasing progress bar / TTL counter. | WebSocket `COUNTERS_UPDATED` / `THRESHOLD_MET`, Player State | Live active countdown timer (mm:ss), multiplier badge | Automatically clear multiplier display when TTL reaches 0. | ORIGINAL_REQUEST.md (L21, L44, L73) |
| 8 | Event Feed | Color-Coded Pipeline Log | Real-time scrollable event stream color-coded by event type: Green (`REWARD_GRANTED`), Amber (`REWARD_DEDUPED`), Blue (`MATCH_RECEIVED`), Purple (`THRESHOLD_MET`), Gray (`RULE_CANDIDATES_FOUND`). | WebSocket pipeline events | Scrollable timeline of timestamped event cards with payload details | Cap log length to 100 items to prevent DOM performance degradation. | ORIGINAL_REQUEST.md (L36, L45) |
| 9 | Player State Inspector | Collapsible JSON Inspector | Collapsible accordion/card revealing raw JSON of selected player's state (streaks, daily counts, windowed history, active multipliers, granted rewards). | Selected Player ID, `GET /api/players/:id/state` response or WebSocket update | Monospaced, syntax-highlighted collapsible JSON tree | Show "Player state unavailable" if player has no recorded history. | ORIGINAL_REQUEST.md (L34, L46) |
| 10 | Rules Config Panel | Rules Card Gallery | Collapsible section rendering active rules as visual cards displaying ID, Strategy (`streak`, `count_in_day`, `count_in_window`), criteria (result, category, threshold), reward, and TTL. | `GET /api/rules` endpoint response | Grid of structured rule cards with strategy icons | Display "No rules configured" empty state if array is empty. | ORIGINAL_REQUEST.md (L32, L47) |
| 11 | Rules Config Panel | Dynamic Rule Creation Form | Form allowing user to define and add a new rule dynamically via `POST /api/rules`. Inputs: Strategy type selector, target category/result, count threshold, window seconds (if windowed), reward type & value. | Form inputs: strategy, target, threshold, reward, windowSeconds | POST request to `/api/rules`, immediate update of Rules Card Gallery | Client-side validation for missing fields; show API error message on failure. | ORIGINAL_REQUEST.md (L33, L47, L61, L72) |
| 12 | System Metrics Strip | Real-Time Metrics Header | Top dashboard bar tracking Total Events Processed, Rewards Granted, Rewards Deduped, Avg Evaluation Time (ms), and Connected WebSocket Clients. | Aggregated socket event metadata & server metrics | Monospaced counters and KPI stats strip | Initialize counters to 0; handle disconnect without losing metric history. | ORIGINAL_REQUEST.md (L48) |
| 13 | Reward Ledger | Sortable Reward Table | Table of granted rewards fetched from `GET /api/ledger` and appended on `REWARD_GRANTED` socket events. Columns: Timestamp, Player ID, Rule ID, Reward Type/Amount, Idempotency Key. Sortable by clicking column headers. | `GET /api/ledger` data, socket events | Interactive sortable data table with search/filter | Render "No rewards granted yet" empty state if ledger is empty. | ORIGINAL_REQUEST.md (L35, L49, L68) |
| 14 | Dev Setup | Root Concurrently Execution | Root `package.json` script `npm run dev` using `concurrently` to launch backend Express server and frontend Vite/React dev server in parallel with single terminal command. | `npm run dev` command | Simultaneous startup of backend (port 3000) and frontend (port 5173) | Terminate both processes cleanly on SIGINT / Ctrl+C. | ORIGINAL_REQUEST.md (L52, L76) |
| 15 | Documentation | Comprehensive README | `README.md` file detailing Architecture Overview, Scaling Discussion (Kafka/Kinesis, Redis Cluster, partition key strategy, distributed idempotency), and explicit Interview Talking Points. | Project design, implementation choices, scaling architecture | Markdown documentation file | Must explicitly state omission of DLQ, event replay, and compound rules. | ORIGINAL_REQUEST.md (L53, L77) |

---

## 4. Edge Cases

| # | Feature | Input | Observed Behavior / Required Handling |
|---|---------|-------|--------------------------------------|
| 1 | Pipeline Visualizer | Multiple match events arriving simultaneously or rapidly during burst simulation. | Pipeline visualizer must queue animations or pulse briefly without freezing, completing visual cycle <1s per event. |
| 2 | Live Player Counters | Player suffers a LOSS after 2 consecutive WINs. | Streak counter resets to 0 immediately; progress bar resets to 0%. |
| 3 | Live Player Counters | Active 2x multiplier TTL expires in real-time. | Multiplier countdown reaches 00:00, progress bar empties, active multiplier badge disappears automatically. |
| 4 | Event Feed | Rapid stream of 100+ events emitted in burst mode. | Feed auto-scrolls to latest event; older entries beyond buffer limit (e.g. 100) are trimmed to maintain performance. |
| 5 | Rules Config Panel | User submits new rule with negative threshold or empty reward field. | Form validation blocks submission with inline error message ("Threshold must be > 0"). |
| 6 | Rules Config Panel | User creates a dynamic rule via UI during active burst simulation. | Backend immediately indexes new rule; subsequent events evaluate against new rule without server restart. |
| 7 | Reward Ledger Table | Duplicate reward trigger occurs for same player + rule + idempotency bucket. | `REWARD_DEDUPED` event is emitted and shown in Event Feed (amber), but NO duplicate row is added to Reward Ledger table. |
| 8 | Reward Ledger Table | Click column header "Timestamp" or "Player ID" to toggle sort order. | Table rows instantly re-sort ascending/descending. |
| 9 | Socket Connection | Backend server restarts or network disconnects temporarily. | Header status badge switches to "Offline/Reconnecting" (red/amber); auto-reconnect restores connection without page reload. |
| 10 | Root `npm run dev` | Running `npm run dev` when ports 3000 or 5173 are already bound. | Terminal displays descriptive port conflict error from concurrently/Vite/Express. |

---

## 5. Acceptance Criteria & Test Scenarios

### 5.1 Acceptance Criteria

1. **Dashboard Architecture & Layout**:
   - Dark-mode monitoring theme is correctly applied across all panels (slate/zinc background, glowing status indicators, crisp typography).
   - Socket.IO client connects to backend WebSocket server on mount and displays connection status ("Connected").

2. **Pipeline Visualizer**:
   - Stage boxes highlight sequentially from left to right (`MATCH_RECEIVED` -> `RULE_CANDIDATES_FOUND` -> `COUNTERS_UPDATED` -> `THRESHOLD_MET` -> `REWARD_GRANTED` / `REWARD_DEDUPED`) within < 1 second on match event arrival.

3. **Match Simulator**:
   - Submitting single match (`POST /api/simulate-match`) returns full evaluation trace JSON and triggers real-time pipeline visualization.
   - Submitting burst match (`POST /api/simulate-burst`) triggers specified N matches with configured small delays between them.

4. **Live Player Counters & Multipliers**:
   - Streak counters update on WIN and reset to 0 on LOSS.
   - Daily count increments and updates progress bar toward threshold.
   - Active multiplier displays countdown timer and real-time TTL progress bar until expiration.

5. **Rule Event Feed**:
   - Events are color-coded: Green for `REWARD_GRANTED`, Amber for `REWARD_DEDUPED`, Blue for `MATCH_RECEIVED`, Purple for `THRESHOLD_MET`.

6. **Collapsible Player State Inspector**:
   - Accordion toggles open/closed cleanly, rendering formatted raw JSON of player state.

7. **Collapsible Rules Config Panel**:
   - Displays active rules in responsive cards.
   - Form submission posts new rule to `POST /api/rules`, immediately updating backend rule evaluation and adding card to gallery.

8. **System Metrics Strip**:
   - Real-time display of Events Processed, Rewards Granted, Rewards Deduped, Avg Evaluation Time (ms), and Connected Clients updates dynamically.

9. **Reward Ledger Table**:
   - Table displays all granted rewards with columns: Timestamp, Player ID, Rule ID, Reward Payload, Idempotency Key.
   - Clicking table column headers sorts rows ascending and descending.

10. **Build & Development Setup**:
    - Single root `package.json` contains `concurrently` script for `npm run dev`.
    - Executing `npm run dev` compiles TypeScript and launches backend and frontend concurrently without errors.

11. **Documentation & Constraints**:
    - `README.md` includes Architecture Overview, Scaling Discussion, and explicit Interview Talking Points.
    - Omission of DLQ, event replay, and compound rules is documented in README talking points.

---

### 5.2 Test Scenarios

#### Test Scenario TS-FE-01: End-to-End Single Match Flow & Visualizer Stage Animation
- **Given**: Frontend dashboard is open and connected to backend WebSocket server.
- **When**: User selects player `player1`, sets result to `WIN`, category to `algebra`, and clicks "Simulate Single Match".
- **Then**:
  1. API request `POST /api/simulate-match` succeeds with 200 OK and returns evaluation trace JSON.
  2. Pipeline visualizer boxes animate in sequence from left to right in <1s.
  3. Live player counters update streak count.
  4. Event feed receives `MATCH_RECEIVED`, `RULE_CANDIDATES_FOUND`, `COUNTERS_UPDATED` events.

#### Test Scenario TS-FE-02: Streak Rule Trigger & Reward Ledger Entry
- **Given**: Seed Rule 1 ("Win 3 matches in a row -> grant 50 coins") is active. Player `player1` has 2 consecutive WINs.
- **When**: User simulates 3rd consecutive `WIN` match for `player1`.
- **Then**:
  1. Pipeline visualizer highlights `THRESHOLD_MET` and `REWARD_GRANTED`.
  2. Event feed displays green `REWARD_GRANTED` entry ("50 coins").
  3. System metrics "Rewards Granted" increments by 1.
  4. Reward Ledger table gains a new row with timestamp, player `player1`, rule ID, reward details, and idempotency key.

#### Test Scenario TS-FE-03: Idempotency & Reward Deduplication Visual Event
- **Given**: A reward has already been granted for player `player1` + rule `streak-3-win` in the current window/bucket.
- **When**: An idempotent duplicate match event arrives within the same bucket.
- **Then**:
  1. Pipeline visualizer highlights `REWARD_DEDUPED` box.
  2. Event feed displays amber `REWARD_DEDUPED` entry.
  3. System metrics "Rewards Deduped" increments by 1.
  4. Reward Ledger table does NOT add a duplicate row.

#### Test Scenario TS-FE-04: Dynamic Rule Addition & Immediate Evaluation
- **Given**: Dynamic rules form is open in Collapsible Rules Config Panel.
- **When**: User enters Strategy: `streak`, Category: `trivia`, Threshold: `2`, Reward: `100 gems`, and submits form.
- **Then**:
  1. HTTP `POST /api/rules` returns 201 Created with new rule payload.
  2. New rule card appears in Rules Config Panel without page reload.
  3. User simulates 2 consecutive trivia WINs for `player2`.
  4. Rule engine evaluates new rule and grants `100 gems` reward.

#### Test Scenario TS-FE-05: Multiplier TTL Countdown Animation
- **Given**: Seed Rule 3 ("Win 2 algebra matches within 1 hr -> activate 2x multiplier for 30 mins") triggers.
- **When**: `REWARD_GRANTED` event arrives activating multiplier.
- **Then**:
  1. Live Player Counters panel renders active multiplier badge ("2x Multiplier").
  2. Multiplier timer starts countdown from 30:00 with progress bar decreasing live.

#### Test Scenario TS-FE-06: Burst Simulator & Metrics Aggregation
- **Given**: System metrics display initial counters.
- **When**: User enters Match Count: `10`, Delay: `100ms` in Match Simulator and clicks "Simulate Burst".
- **Then**:
  1. 10 matches are processed sequentially.
  2. System metrics "Events Processed" increases by 10.
  3. Event feed streams 10 match processing events smoothly.

#### Test Scenario TS-FE-07: Root Setup & Developer Workflow Verification
- **Given**: Fresh clone in project directory `/home/ebis/matiks`.
- **When**: Developer runs `npm run dev` from root.
- **Then**:
  1. `concurrently` launches backend Express server (port 3000) and frontend Vite server (port 5173).
  2. Both servers start without TypeScript compilation errors or startup crashes.

---

## 6. Caveats
- No existing source code in `src/` currently exists in `/home/ebis/matiks`; specification is derived entirely from `ORIGINAL_REQUEST.md`.
- Component layout, color themes (e.g. Tailwind palette selection: bg-slate-900 / zinc-900, emerald for granted rewards, amber for deduped rewards), and specific Socket.IO reconnection logic are specified based on standard Grafana/Datadog dark-mode monitoring patterns adhering to all prompt constraints.

---

## 7. Conclusion
All functional and UI/UX requirements for the React + TypeScript + TailwindCSS + Socket.IO dashboard architecture, 8 UI components, root `package.json` setup, `README.md` requirements, acceptance criteria, and detailed test scenarios have been thoroughly extracted, documented, and cross-verified against `ORIGINAL_REQUEST.md`.

---

## 8. Verification Method
1. Verify layout compliance: `handoff.md` written in `/home/ebis/matiks/.agents/spec_miner_survey_2/handoff.md`.
2. Inspect `handoff.md` to confirm all 15 Features Discovered and 10 Edge Cases are documented with complete inputs, outputs, error behaviors, and acceptance criteria.
3. Validate coverage against `ORIGINAL_REQUEST.md` (Lines 1-78) ensuring no requirement or UI component was omitted.
