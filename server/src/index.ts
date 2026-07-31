/**
 * index.ts — Server Entry Point
 *
 * Wires together:
 * - Express HTTP server
 * - Socket.IO for real-time pipeline event streaming
 * - RuleEngine, RewardDispatcher, EventBus
 * - Seed rules loaded at startup
 * - API routes mounted at /api
 * - Static frontend serving or redirect to dev port 5173
 */

import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { keyValueStore } from './store/KeyValueStore';
import { eventBus } from './domain/EventBus';
import { getSeedRules } from './domain/seedRules';
import { RuleEngine } from './engine/RuleEngine';
import { RewardDispatcher } from './engine/RewardDispatcher';
import { createApiRouter } from './api/routes';
import { registerSocketHandlers } from './api/socketHandlers';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

async function bootstrap() {
  const app = express();
  const httpServer = http.createServer(app);

  // Initialize Redis Cloud Connection
  await keyValueStore.initRedis();

  // ── Socket.IO ────────────────────────────────────────────────────────────
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // ── Core Services ─────────────────────────────────────────────────────────
  const engine = new RuleEngine(keyValueStore, eventBus);
  const dispatcher = new RewardDispatcher(keyValueStore, eventBus);

  // Load rules from Redis Cloud store, or seed initial rules if database is empty
  let loadedCount = await engine.loadRulesFromStore();
  if (loadedCount === 0) {
    const seedRules = getSeedRules();
    for (const rule of seedRules) {
      await engine.registerRule(rule);
    }
    console.log(`[bootstrap] Loaded ${seedRules.length} seed rules into Redis Cloud`);
  } else {
    console.log(`[bootstrap] Loaded ${loadedCount} persisted rules from Redis Cloud`);
  }

  // ── Middleware ────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // ── Metrics (in-memory, shared with routes) ───────────────────────────────
  const metrics = {
    eventsProcessed: 0,
    rewardsGranted: 0,
    rewardsDeduped: 0,
    totalEvalTimeMs: 0,
    evalCount: 0,
  };

  // ── Socket.IO event bridge ─────────────────────────────────────────────────
  // Forward internal domain events onto the WebSocket bus so the dashboard
  // can animate each pipeline stage in real-time.
  registerSocketHandlers(io, eventBus, metrics);

  // ── API Routes ────────────────────────────────────────────────────────────
  const apiRouter = createApiRouter(engine, dispatcher, io, metrics);
  app.use('/api', apiRouter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: Date.now() });
  });

  // ── Frontend Static / Redirect ────────────────────────────────────────────
  const distPath = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.redirect('http://localhost:5173');
    });
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  httpServer.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[bootstrap] Fatal error:', err);
  process.exit(1);
});
