/**
 * routes.ts — REST API Router
 *
 * Endpoints:
 *   POST /api/simulate-match   – Process a single match event through the full pipeline
 *   POST /api/simulate-burst   – Fire N matches rapidly to demo streak/window rules
 *   GET  /api/rules            – List all registered rules
 *   POST /api/rules            – Add a new rule dynamically (no restart needed)
 *   GET  /api/players/:id/state – Return current player state (counters + inventory)
 *   GET  /api/ledger           – Full reward ledger
 *   GET  /api/metrics          – System metrics snapshot
 */

import { Router, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RuleEngine } from '../engine/RuleEngine';
import { RewardDispatcher } from '../engine/RewardDispatcher';
import { MatchCompletedEvent, Rule } from '../domain/models';
import { buildMetricsPayload } from './socketHandlers';
import { keyValueStore } from '../store/KeyValueStore';
import { getSeedRules } from '../domain/seedRules';

interface Metrics {
  eventsProcessed: number;
  rewardsGranted: number;
  rewardsDeduped: number;
  totalEvalTimeMs: number;
  evalCount: number;
}

export function createApiRouter(
  engine: RuleEngine,
  dispatcher: RewardDispatcher,
  io: SocketIOServer,
  metrics: Metrics
): Router {
  const router = Router();

  // ── POST /simulate-match ──────────────────────────────────────────────────
  router.post('/simulate-match', async (req: Request, res: Response) => {
    const { playerId, result, category } = req.body;

    if (!playerId || !result || !category) {
      res.status(400).json({ error: 'playerId, result, category are required' });
      return;
    }

    if (result !== 'WIN' && result !== 'LOSS' && result !== 'DRAW') {
      res.status(400).json({ error: 'result must be WIN, LOSS, or DRAW' });
      return;
    }

    const event: MatchCompletedEvent = {
      eventId: uuidv4(),
      playerId,
      matchId: uuidv4(),
      category: category.toLowerCase(),
      result,
      timestamp: Date.now(),
    };

    // Stage 1: Broadcast MATCH_RECEIVED
    io.emit('MATCH_RECEIVED', {
      eventId: event.eventId,
      playerId: event.playerId,
      category: event.category,
      result: event.result,
      timestamp: event.timestamp,
    });

    // Stage 2: Find candidate rules and broadcast
    const candidates = engine.getCandidateRules(event.category, event.result);
    io.emit('RULE_CANDIDATES_FOUND', {
      playerId: event.playerId,
      candidateRuleIds: candidates.map((r) => r.id),
      candidateRuleNames: candidates.map((r) => r.name),
      count: candidates.length,
    });

    // Stage 3: Run evaluation (counters update, threshold checks, reward dispatch)
    const startTime = performance.now();
    const trace = await engine.evaluateMatch(event);
    const evalTimeMs = performance.now() - startTime;

    // Update rolling metrics
    metrics.eventsProcessed++;
    metrics.totalEvalTimeMs += evalTimeMs;
    metrics.evalCount++;

    // Stage 4: Broadcast counter updates from evaluations
    io.emit('COUNTERS_UPDATED', {
      playerId: event.playerId,
      evaluations: trace.evaluations.map((e) => ({
        ruleId: e.ruleId,
        ruleName: e.ruleName,
        currentCount: e.currentCount,
        targetCount: e.targetCount,
        triggered: e.triggered,
        reason: e.reason,
      })),
    });

    // Emit updated metrics
    io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));

    // Fetch latest player state
    const playerState = await dispatcher.getPlayerState(playerId);
    io.emit('PLAYER_STATE_UPDATE', playerState);

    res.json({
      eventId: event.eventId,
      trace: {
        matchEvent: trace.matchEvent,
        candidateRules: trace.candidateRules.map((r) => ({ id: r.id, name: r.name, type: r.type })),
        evaluations: trace.evaluations,
        triggeredRewards: trace.triggeredRewards,
        evaluatedAt: trace.evaluatedAt,
        executionTimeMs: parseFloat(evalTimeMs.toFixed(3)),
      },
    });
  });

  // ── POST /simulate-burst ──────────────────────────────────────────────────
  // Fires N matches with a 200ms delay between each, useful for demoing
  // streak and windowed rules accumulating in real time on the dashboard.
  router.post('/simulate-burst', async (req: Request, res: Response) => {
    const { playerId, count, result, category } = req.body;
    const matchCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);
    const matchResult = result || 'WIN';
    const matchCategory = (category || 'general').toLowerCase();

    if (!playerId) {
      res.status(400).json({ error: 'playerId is required' });
      return;
    }

    // Respond immediately; matches fire asynchronously
    res.json({ message: `Burst of ${matchCount} matches queued for ${playerId}` });

    // Fire matches with 200ms spacing so the frontend animation is visible
    for (let i = 0; i < matchCount; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));

      const event: MatchCompletedEvent = {
        eventId: uuidv4(),
        playerId,
        matchId: uuidv4(),
        category: matchCategory,
        result: matchResult,
        timestamp: Date.now(),
      };

      io.emit('MATCH_RECEIVED', {
        eventId: event.eventId,
        playerId: event.playerId,
        category: event.category,
        result: event.result,
        timestamp: event.timestamp,
        burstIndex: i + 1,
        burstTotal: matchCount,
      });

      const candidates = engine.getCandidateRules(event.category, event.result);
      io.emit('RULE_CANDIDATES_FOUND', {
        playerId: event.playerId,
        candidateRuleIds: candidates.map((r) => r.id),
        count: candidates.length,
      });

      const startTime = performance.now();
      const trace = await engine.evaluateMatch(event);
      const evalTimeMs = performance.now() - startTime;

      metrics.eventsProcessed++;
      metrics.totalEvalTimeMs += evalTimeMs;
      metrics.evalCount++;

      io.emit('COUNTERS_UPDATED', {
        playerId: event.playerId,
        evaluations: trace.evaluations.map((e) => ({
          ruleId: e.ruleId,
          ruleName: e.ruleName,
          currentCount: e.currentCount,
          targetCount: e.targetCount,
          triggered: e.triggered,
        })),
      });

      io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));

      const playerState = await dispatcher.getPlayerState(playerId);
      io.emit('PLAYER_STATE_UPDATE', playerState);
    }
  });

  // ── GET /rules ─────────────────────────────────────────────────────────────
  router.get('/rules', (_req: Request, res: Response) => {
    const rules = engine.getAllRules();
    res.json({ rules, count: rules.length });
  });

  // ── POST /rules ────────────────────────────────────────────────────────────
  // Dynamic rule addition — the core demo of "rules are data, not code".
  // A new rule registered here is immediately indexed and evaluated on the next
  // match event, with zero restarts or code changes.
  router.post('/rules', async (req: Request, res: Response) => {
    const body = req.body as Partial<Rule>;

    if (!body.name || !body.type || !body.targetCount || !body.reward) {
      res.status(400).json({
        error: 'name, type, targetCount, reward are required',
        example: {
          name: 'Quick Learner',
          description: 'Win 2 speed matches in a row',
          type: 'STREAK',
          targetCount: 2,
          category: 'speed',
          resultFilter: 'WIN',
          reward: { type: 'COINS', amount: 25 },
          enabled: true,
        },
      });
      return;
    }

    const newRule: Rule = {
      id: body.id || `rule_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: body.name,
      description: body.description || '',
      type: body.type,
      targetCount: body.targetCount,
      category: body.category,
      resultFilter: body.resultFilter,
      windowSeconds: body.windowSeconds,
      reward: body.reward,
      enabled: body.enabled !== false,
      createdAt: Date.now(),
    };

    await engine.registerRule(newRule);
    console.log(`[api] New rule registered to Redis Cloud: ${newRule.id} (${newRule.name})`);

    // Notify all dashboard clients so the Rules panel updates immediately
    io.emit('RULE_ADDED', newRule);

    res.status(201).json({ rule: newRule });
  });

  // ── DELETE /rules/:id ──────────────────────────────────────────────────────
  router.delete('/rules/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const removed = engine.unregisterRule(id); // also removes from Redis
    if (!removed) {
      res.status(404).json({ error: `Rule "${id}" not found` });
      return;
    }
    console.log(`[api] Rule deleted from Redis Cloud: ${id}`);
    io.emit('RULE_DELETED', { id });
    res.json({ success: true, deletedId: id });
  });

  // ── GET /players/:id/state ─────────────────────────────────────────────────
  router.get('/players/:id/state', async (req: Request, res: Response) => {
    const { id } = req.params;
    const state = await dispatcher.getPlayerState(id);
    res.json(state);
  });

  // ── GET /ledger ────────────────────────────────────────────────────────────
  router.get('/ledger', async (_req: Request, res: Response) => {
    await dispatcher.syncLedgerFromStore();
    const entries = dispatcher.getLedger();
    res.json({ entries, count: entries.length });
  });

  // ── GET /metrics ────────────────────────────────────────────────────────────
  router.get('/metrics', (_req: Request, res: Response) => {
    res.json(buildMetricsPayload(io, metrics));
  });

  // ── GET /store/keys ─────────────────────────────────────────────────────────
  router.get('/store/keys', async (_req: Request, res: Response) => {
    const keys = await keyValueStore.getKeysDetail();
    res.json({
      mode: keyValueStore.getMode(),
      isRealRedis: keyValueStore.isUsingRealRedis(),
      count: keys.length,
      keys,
    });
  });

  // ── POST /store/flush ───────────────────────────────────────────────────────
  router.post('/store/flush', async (_req: Request, res: Response) => {
    await keyValueStore.flushAll();
    dispatcher.clear();
    engine.clear();
    
    // Re-seed default rules into store
    const seedRules = getSeedRules();
    for (const rule of seedRules) {
      await engine.registerRule(rule);
    }

    // Reset system metrics
    metrics.eventsProcessed = 0;
    metrics.rewardsGranted = 0;
    metrics.rewardsDeduped = 0;
    metrics.totalEvalTimeMs = 0;
    metrics.evalCount = 0;

    io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));
    io.emit('STORE_FLUSHED', { timestamp: new Date().toISOString() });
    res.json({ success: true, message: 'Database store and metrics successfully reset to 0 records.' });
  });

  return router;
}
