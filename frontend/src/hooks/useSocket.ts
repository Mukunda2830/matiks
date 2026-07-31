/// <reference types="vite/client" />
/**
 * useSocket.ts — Socket.IO React hook
 *
 * Establishes a single Socket.IO connection and exposes typed event
 * callbacks. The dashboard subscribes to pipeline events here and
 * propagates them up via state updates.
 */
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  MatchReceivedPayload,
  RuleCandidatesFoundPayload,
  CountersUpdatedPayload,
  ThresholdMetPayload,
  RewardGrantedPayload,
  RewardDedupedPayload,
  MetricsPayload,
  PlayerState,
  Rule,
} from '../types';

const SOCKET_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? window.location.origin : 'http://localhost:3001');

export interface SocketCallbacks {
  onMatchReceived?: (payload: MatchReceivedPayload) => void;
  onRuleCandidatesFound?: (payload: RuleCandidatesFoundPayload) => void;
  onCountersUpdated?: (payload: CountersUpdatedPayload) => void;
  onThresholdMet?: (payload: ThresholdMetPayload) => void;
  onRewardGranted?: (payload: RewardGrantedPayload) => void;
  onRewardDeduped?: (payload: RewardDedupedPayload) => void;
  onMetricsUpdate?: (payload: MetricsPayload) => void;
  onPlayerStateUpdate?: (payload: PlayerState) => void;
  onRuleAdded?: (rule: Rule) => void;
  onStoreFlushed?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef = useRef<Socket | null>(null);
  // Keep callbacks in a ref so we don't need to re-subscribe on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => callbacksRef.current.onConnect?.());
    socket.on('disconnect', () => callbacksRef.current.onDisconnect?.());

    socket.on('MATCH_RECEIVED', (p: MatchReceivedPayload) =>
      callbacksRef.current.onMatchReceived?.(p)
    );
    socket.on('RULE_CANDIDATES_FOUND', (p: RuleCandidatesFoundPayload) =>
      callbacksRef.current.onRuleCandidatesFound?.(p)
    );
    socket.on('COUNTERS_UPDATED', (p: CountersUpdatedPayload) =>
      callbacksRef.current.onCountersUpdated?.(p)
    );
    socket.on('THRESHOLD_MET', (p: ThresholdMetPayload) =>
      callbacksRef.current.onThresholdMet?.(p)
    );
    socket.on('REWARD_GRANTED', (p: RewardGrantedPayload) =>
      callbacksRef.current.onRewardGranted?.(p)
    );
    socket.on('REWARD_DEDUPED', (p: RewardDedupedPayload) =>
      callbacksRef.current.onRewardDeduped?.(p)
    );
    socket.on('METRICS_UPDATE', (p: MetricsPayload) =>
      callbacksRef.current.onMetricsUpdate?.(p)
    );
    socket.on('PLAYER_STATE_UPDATE', (p: PlayerState) =>
      callbacksRef.current.onPlayerStateUpdate?.(p)
    );
    socket.on('RULE_ADDED', (rule: Rule) =>
      callbacksRef.current.onRuleAdded?.(rule)
    );
    socket.on('STORE_FLUSHED', () =>
      callbacksRef.current.onStoreFlushed?.()
    );

    return () => {
      socket.disconnect();
    };
  }, []); // Only run once on mount

  return { emit };
}
