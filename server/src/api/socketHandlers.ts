/**
 * socketHandlers.ts — Socket.IO + Internal Event Bus Bridge
 *
 * Listens to internal domain events (EventBus) and re-emits them onto
 * connected WebSocket clients so the dashboard can animate pipeline stages
 * in real time.
 *
 * WebSocket events emitted:
 *   MATCH_RECEIVED         – A match event entered the pipeline
 *   RULE_CANDIDATES_FOUND  – Index lookup returned candidate rules
 *   COUNTERS_UPDATED       – Per-player counters were incremented
 *   THRESHOLD_MET          – A rule threshold was crossed
 *   REWARD_GRANTED         – Reward written to ledger
 *   REWARD_DEDUPED         – Idempotency check blocked a duplicate grant
 *   METRICS_UPDATE         – Rolling system metrics snapshot
 *   PLAYER_STATE_UPDATE    – Updated player state snapshot
 */

import { Server as SocketIOServer } from 'socket.io';
import { EventBus } from '../domain/EventBus';

interface Metrics {
  eventsProcessed: number;
  rewardsGranted: number;
  rewardsDeduped: number;
  totalEvalTimeMs: number;
  evalCount: number;
}

export function registerSocketHandlers(
  io: SocketIOServer,
  eventBus: EventBus,
  metrics: Metrics
): void {
  io.on('connection', (socket) => {
    console.log(`[socket] Client connected: ${socket.id}`);

    // Broadcast live connected-client count whenever it changes
    io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));

    socket.on('disconnect', () => {
      console.log(`[socket] Client disconnected: ${socket.id}`);
      io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));
    });
  });

  // ── Internal EventBus → WebSocket bridge ─────────────────────────────────

  eventBus.on('RewardTriggered', (event) => {
    io.emit('THRESHOLD_MET', {
      playerId: event.playerId,
      ruleId: event.ruleId,
      ruleName: event.ruleName,
      reward: event.reward,
      idempotencyKey: event.idempotencyKey,
      timestamp: event.triggeredAt,
    });
  });

  eventBus.on('RewardGranted', ({ ledgerEntry, playerState }) => {
    metrics.rewardsGranted++;
    io.emit('REWARD_GRANTED', { ledgerEntry, playerState });
    io.emit('PLAYER_STATE_UPDATE', playerState);
    io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));
  });

  eventBus.on('RewardDeduped', (payload) => {
    metrics.rewardsDeduped++;
    io.emit('REWARD_DEDUPED', payload);
    io.emit('METRICS_UPDATE', buildMetricsPayload(io, metrics));
  });
}

function buildMetricsPayload(io: SocketIOServer, metrics: Metrics) {
  const avgEvalTime =
    metrics.evalCount > 0
      ? parseFloat((metrics.totalEvalTimeMs / metrics.evalCount).toFixed(2))
      : 0;

  return {
    eventsProcessed: metrics.eventsProcessed,
    rewardsGranted: metrics.rewardsGranted,
    rewardsDeduped: metrics.rewardsDeduped,
    avgEvalTimeMs: avgEvalTime,
    connectedClients: io.engine.clientsCount,
    timestamp: Date.now(),
  };
}

// Export so routes can also emit custom pipeline events
export { buildMetricsPayload };
