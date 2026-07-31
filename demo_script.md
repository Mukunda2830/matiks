# 5-Minute Demo Script
## Matiks — Player Reward Rule Engine

---

## PRE-RECORDING CHECKLIST (do this before hitting record)

- [ ] Open browser, go to your Vercel frontend URL
- [ ] Open a second tab: `https://matiks-7puu.onrender.com/health` — wait until you see `{"status":"ok"}`
- [ ] Zoom browser to 120% (Ctrl + Plus)
- [ ] Turn off all notifications (phone on silent, Chrome notifications off)
- [ ] Close all unrelated tabs
- [ ] Have Loom / OBS ready
- [ ] Do one silent practice run clicking through the simulator

---

## SEGMENT 1 — Introduction [0:00 – 0:30]

**ACTION**: Screen is showing the full dashboard. Pause on it for 3 seconds before speaking.

---

**SAY**:

"Hi. What you're looking at is a real-time Player Reward Rule Engine — a backend system I built to solve a specific problem:

How do you evaluate rules like — win 3 matches in a row, play 5 matches in a single day, or win 2 algebra matches within 1 hour — without any hardcoded if-else logic, while guaranteeing that every reward is granted exactly once, even under duplicate or concurrent requests?

Let me walk you through how it works."

---

## SEGMENT 2 — Rules are Data, Not Code [0:30 – 1:20]

**ACTION**: Scroll down to the Rules Panel. Point cursor slowly at each rule card.

---

**SAY**:

"First — the rules. There are 3 rules currently active, and all of them are pure JSON data stored in Redis Cloud — not hardcoded anywhere in the application.

This first one is a Streak rule. It says: win 3 matches in a row and get 50 coins. The engine tracks a consecutive counter per player per rule in Redis.

This second one is a Daily Count rule. Play 5 matches in a single day and earn a loot box. The counter resets at UTC midnight automatically via a Redis TTL.

This third one is a Sliding Window rule. Win 2 algebra matches within any rolling 1-hour window and activate a 2x score multiplier. The window is truly sliding — not a fixed hourly bucket.

Now — the key design point. I can add a completely new rule right now, with zero code changes and zero server restarts."

**ACTION**: Click "Add Rule" or open the rule form. Type in:
- Name: `Quick Win`
- Type: `STREAK`
- Target Count: `1`
- Reward: `COINS` / `25`
- Click Submit

**SAY**:

"Done. That rule is now live — persisted to Redis — and will be evaluated on the very next match event. No deployment, no restart."

---

## SEGMENT 3 — Firing a Match and the Pipeline [1:20 – 2:30]

**ACTION**: Go to the Match Simulator. Select:
- Player: `player_1`
- Category: `general`
- Result: `WIN`

Point cursor at the Pipeline Visualizer strip at the top of the screen.

---

**SAY**:

"Now I'll simulate match events. Watch the pipeline visualizer at the top — each stage lights up in sequence as the event flows through the system.

I'll fire the first win."

**ACTION**: Click Simulate Match.

**SAY**:

"Stage 1 — Match Event received. The event has a unique ID, a player ID, a category, and a result.

Stage 2 — Rule Candidates Found. This is where the Rule Indexer runs. Instead of scanning every rule with a filter, the engine uses a pre-built composite key map — category colon result. It looks up matching rules in constant time — O of 1 — regardless of how many rules are registered.

Stage 3 — Player Counters Updated. The streak counter for player 1 just moved from 0 to 1 out of 3. That counter lives in Redis."

**ACTION**: Click Simulate Match again (second WIN).

**SAY**:

"Second win. Streak counter is now 2 of 3."

**ACTION**: Click Simulate Match one more time (third WIN).

**SAY**:

"Third win — threshold crossed. Watch what happens."

**ACTION**: Point to the Reward Ledger or Feed showing GRANTED.

**SAY**:

"The Reward Dispatcher ran. It placed an atomic Redis lock using SET NX — set if not exists — a single atomic command. The lock was acquired, so the reward was granted. 50 coins added to the player's inventory.

And this entry here in the Reward Ledger — status GRANTED — is an immutable audit record written to Redis. It survives server restarts."

---

## SEGMENT 4 — Idempotency Demo [2:30 – 3:10]

**ACTION**: Click Simulate Match one more time with the same settings.

---

**SAY**:

"Now I'll fire the exact same match again — same player, same conditions."

**ACTION**: Point to the Reward Ledger or Feed showing DEDUPED.

**SAY**:

"DEDUPED. The system generated the same idempotency key — player ID, rule ID, cycle, and streak step — and tried to acquire the same Redis lock. The lock already existed, so the reward was blocked.

The coins did not go up again. This is the exactly-once guarantee. It works even if a client retries a request, even if two requests arrive at the same millisecond. The atomicity comes from Redis itself — not from application-level locking."

---

## SEGMENT 5 — Sliding Window Rule [3:10 – 3:50]

**ACTION**: Change the Simulator to:
- Category: `algebra`
- Result: `WIN`

---

**SAY**:

"Now the windowed rule. I'll switch to the algebra category and fire two wins."

**ACTION**: Click Simulate Match twice.

**SAY**:

"Two algebra wins within the 1-hour window — the multiplier is activated.

The sliding window works like this: on every match event, the engine fetches the player's window set from Redis, removes any events older than 1 hour, adds the new event, then checks if the count meets the target.

It is a true sliding window. If I fired one algebra win now and another in 59 minutes, it would still trigger — it is not resetting on the hour mark."

**ACTION**: If the Redis Key Inspector is visible, point to the window key.

**SAY**:

"You can see the actual Redis key here — player colon player underscore 1 colon window colon rule ID — showing the raw events stored in the set."

---

## SEGMENT 6 — Architecture and Closing [3:50 – 5:00]

**ACTION**: Open a new tab and go to `https://matiks-7puu.onrender.com/api/rules`

---

**SAY**:

"Let me show the live backend. This is the Render deployment — a Node.js Express server with Socket.IO, connected to a real Redis Cloud instance."

**ACTION**: Point to the JSON response showing 3 rules.

**SAY**:

"These rules were loaded at server startup from Redis — not from a config file, not hardcoded. Every rule change I made during this demo is already persisted here.

The frontend is deployed separately on Vercel. The two communicate over HTTP for API calls and over WebSocket for real-time pipeline events — every stage you saw light up on the dashboard was a Socket.IO event pushed from the backend in real time."

**ACTION**: Go back to the dashboard tab.

**SAY**:

"To summarize the key design decisions:

One — Rule selection is O of 1. The indexer uses a two-dimensional composite key map built at registration time. No scanning. No if-else chains. Adding a thousand rules does not slow down evaluation.

Two — Idempotency is atomic. The Redis SET NX command is a single operation. There is no window between checking and writing where a race condition can occur.

Three — All state is in Redis. Streak counters, daily counts, sliding windows, inventory, dedup locks, the reward ledger — everything. The application server is stateless and can be replaced or restarted without data loss.

Four — New rule types are a single file. The Strategy Pattern means adding a new evaluation algorithm requires implementing one interface — the transport, storage, and dispatch layers are completely untouched.

That's the system. Thank you."

---

## DELIVERY NOTES

**Pacing:**
- Speak slower than feels natural — recordings always sound faster than in-person
- Pause 1 full second after every time you click something — let the visual change settle before talking about it
- Do not read robotically — glance at the script, then look at the screen while talking

**What to emphasize:**
- Say "O of 1" clearly and pause after it — that is the answer to the interview question
- Say "atomic Redis command" when showing idempotency — that is the other key answer
- Say "zero code changes, zero restarts" when adding the rule live

**What to skip if you are running short on time:**
- The Redis Key Inspector detail
- The second tab showing the raw API response
- You can cut Segment 5 to just one algebra win and say "the window rule would trigger at 2 wins"

**If Render is slow to respond:**
- Say: "The backend is on Render's free tier which spins down between requests — in production this would be a persistent instance"
- Do not apologize or fill silence — just wait and move on

---

## TOTAL TIME BREAKDOWN

| Segment | Content | Time |
|:---|:---|:---|
| 1 | Introduction | 0:30 |
| 2 | Rules Panel + Add Rule Live | 0:50 |
| 3 | Match Simulation + Pipeline | 1:10 |
| 4 | Idempotency DEDUPED Demo | 0:40 |
| 5 | Sliding Window Rule | 0:40 |
| 6 | Architecture Summary + Closing | 1:10 |
| **Total** | | **5:00** |
