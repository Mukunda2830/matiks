/**
 * App.tsx — Root application component
 *
 * Orchestrates all dashboard sections:
 *   1. PipelineVisualizer   — animated stage highlight strip
 *   2. MatchSimulator       — left sidebar
 *   3. PlayerCounters       — center live counters
 *   4. RuleFeed             — right scrolling event log
 *   5. PlayerStateInspector — collapsible raw JSON
 *   6. RulesPanel           — collapsible rule cards + add form
 *   7. SystemMetrics        — stats strip
 *   8. RewardLedger         — sortable table
 *
 * All real-time updates flow from useSocket → local state → components.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Layers, Activity, Wifi, WifiOff, RotateCcw } from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import { PipelineVisualizer } from './components/PipelineVisualizer';
import { MatchSimulator } from './components/MatchSimulator';
import { PlayerCounters } from './components/PlayerCounters';
import { RuleFeed } from './components/RuleFeed';
import { PlayerStateInspector } from './components/PlayerStateInspector';
import { RulesPanel } from './components/RulesPanel';
import { SystemMetrics } from './components/SystemMetrics';
import { RewardLedger } from './components/RewardLedger';
import { RedisKeyInspector } from './components/RedisKeyInspector';
import {
  PipelineStage,
  FeedEntry,
  PlayerState,
  LedgerEntry,
  Rule,
  MetricsPayload,
  MatchReceivedPayload,
  RuleCandidatesFoundPayload,
  CountersUpdatedPayload,
  ThresholdMetPayload,
  RewardGrantedPayload,
  RewardDedupedPayload,
} from './types';

import GlitchText from './reactbits/GlitchText';
import GradientText from './reactbits/GradientText';

let feedIdCounter = 0;
function makeFeedEntry(
  message: string,
  level: FeedEntry['level'],
  detail?: string
): FeedEntry {
  return {
    id: `feed_${++feedIdCounter}`,
    level,
    message,
    detail,
    timestamp: Date.now(),
  };
}

const MAX_FEED_ENTRIES = 200;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState('player_1');
  const [activeStage, setActiveStage] = useState<PipelineStage>('idle');
  const [lastRewardStage, setLastRewardStage] = useState<'REWARD_GRANTED' | 'REWARD_DEDUPED' | null>(null);
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [playerStates, setPlayerStates] = useState<Record<string, PlayerState>>({});
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [flushing, setFlushing] = useState(false);

  // Stage auto-reset timer ref
  const stageResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushFeed(entry: FeedEntry) {
    setFeedEntries((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_FEED_ENTRIES ? next.slice(-MAX_FEED_ENTRIES) : next;
    });
  }

  function activateStage(stage: PipelineStage, resetDelay = 800) {
    setActiveStage(stage);
    if (stageResetTimer.current) clearTimeout(stageResetTimer.current);
    stageResetTimer.current = setTimeout(() => setActiveStage('idle'), resetDelay);
  }

  // Load initial rules on mount
  useEffect(() => {
    fetch('/api/rules')
      .then((r) => r.json())
      .then((data) => {
        if (data.rules) setRules(data.rules);
      })
      .catch(() => {});
  }, []);

  // Load initial ledger
  useEffect(() => {
    fetch('/api/ledger')
      .then((r) => r.json())
      .then((data) => {
        if (data.entries) setLedgerEntries(data.entries);
      })
      .catch(() => {});
  }, []);

  const handlePlayerChange = useCallback((p: string) => {
    setSelectedPlayer(p);
    // Fetch state for newly selected player
    fetch(`/api/players/${p}/state`)
      .then((r) => r.json())
      .then((state: PlayerState) => {
        setPlayerStates((prev) => ({ ...prev, [p]: state }));
      })
      .catch(() => {});
  }, []);

  const resetAllLocalState = useCallback(() => {
    setLedgerEntries([]);
    setPlayerStates({});
    setMetrics({
      eventsProcessed: 0,
      rewardsGranted: 0,
      rewardsDeduped: 0,
      avgEvalTimeMs: 0,
      connectedClients: 1,
      timestamp: Date.now(),
    });
    handlePlayerChange(selectedPlayer);
  }, [handlePlayerChange, selectedPlayer]);

  const handleFlushStore = async () => {
    if (!window.confirm('Reset database keys, player states, and metrics to 0 records?')) return;
    setFlushing(true);
    try {
      const res = await fetch('/api/store/flush', { method: 'POST' });
      if (res.ok) {
        resetAllLocalState();
        pushFeed(makeFeedEntry('Database store & metrics reset to 0 records', 'warning'));
      }
    } catch (err) {
      console.error('Failed to flush store:', err);
    } finally {
      setFlushing(false);
    }
  };

  useSocket({
    onConnect: useCallback(() => {
      setConnected(true);
      pushFeed(makeFeedEntry('WebSocket connected to engine', 'success'));
    }, []),

    onDisconnect: useCallback(() => {
      setConnected(false);
      pushFeed(makeFeedEntry('WebSocket disconnected', 'warning'));
    }, []),

    onMatchReceived: useCallback((p: MatchReceivedPayload) => {
      activateStage('MATCH_RECEIVED');
      const burst = p.burstIndex ? ` [burst ${p.burstIndex}/${p.burstTotal}]` : '';
      pushFeed(
        makeFeedEntry(
          `Match received: ${p.playerId} ${p.result} in ${p.category}${burst}`,
          'info',
          `event: ${p.eventId}`
        )
      );
    }, []),

    onRuleCandidatesFound: useCallback((p: RuleCandidatesFoundPayload) => {
      activateStage('RULE_CANDIDATES_FOUND');
      pushFeed(
        makeFeedEntry(
          `Rule index lookup: ${p.count} candidate rule${p.count !== 1 ? 's' : ''} for ${p.playerId}`,
          'info',
          p.candidateRuleNames?.join(', ')
        )
      );
    }, []),

    onCountersUpdated: useCallback((p: CountersUpdatedPayload) => {
      activateStage('COUNTERS_UPDATED');
      for (const ev of p.evaluations) {
        pushFeed(
          makeFeedEntry(
            `${ev.ruleName}: counter ${ev.currentCount} / ${ev.targetCount}${ev.triggered ? ' [THRESHOLD MET]' : ''}`,
            ev.triggered ? 'success' : 'info',
            ev.reason
          )
        );
      }
    }, []),

    onThresholdMet: useCallback((p: ThresholdMetPayload) => {
      activateStage('THRESHOLD_MET');
      pushFeed(
        makeFeedEntry(
          `Threshold met: ${p.ruleName} -> dispatching ${p.reward.type}`,
          'success',
          `key: ${p.idempotencyKey}`
        )
      );
    }, []),

    onRewardGranted: useCallback(({ ledgerEntry, playerState }: RewardGrantedPayload) => {
      activateStage('REWARD_GRANTED', 1200);
      setLastRewardStage('REWARD_GRANTED');
      setPlayerStates((prev) => ({ ...prev, [playerState.playerId]: playerState }));
      setLedgerEntries((prev: LedgerEntry[]) => [...prev, ledgerEntry]);
      pushFeed(
        makeFeedEntry(
          `Reward GRANTED: ${ledgerEntry.ruleName} -> ${ledgerEntry.reward.amount} ${ledgerEntry.reward.type} for ${ledgerEntry.playerId}`,
          'success',
          `idempotency: ${ledgerEntry.idempotencyKey}`
        )
      );
      setTimeout(() => setLastRewardStage(null), 2000);
    }, []),

    onRewardDeduped: useCallback((p: RewardDedupedPayload) => {
      activateStage('REWARD_DEDUPED', 1000);
      setLastRewardStage('REWARD_DEDUPED');
      pushFeed(
        makeFeedEntry(
          `Reward DEDUPED (idempotency): ${p.ruleId} for ${p.playerId}`,
          'warning',
          `key: ${p.idempotencyKey}`
        )
      );
      setTimeout(() => setLastRewardStage(null), 2000);
    }, []),

    onMetricsUpdate: useCallback((m: MetricsPayload) => {
      setMetrics(m);
    }, []),

    onPlayerStateUpdate: useCallback((state: PlayerState) => {
      setPlayerStates((prev) => ({ ...prev, [state.playerId]: state }));
    }, []),

    onRuleAdded: useCallback((rule: Rule) => {
      setRules((prev: Rule[]) => {
        if (prev.find((r) => r.id === rule.id)) return prev;
        return [...prev, rule];
      });
      pushFeed(makeFeedEntry(`New rule added live: "${rule.name}"`, 'success'));
    }, []),

    onStoreFlushed: useCallback(() => {
      resetAllLocalState();
      pushFeed(makeFeedEntry('Database store reset by server', 'warning'));
    }, [resetAllLocalState]),
  });

  const currentPlayerState = playerStates[selectedPlayer] ?? null;

  return (
    <div className="min-h-screen bg-panel flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 px-6 py-3.5 flex items-center gap-4 bg-white/90 backdrop-blur-md shadow-sm flex-shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-2">
            <GlitchText speed={1.5} enableShadows={false} enableOnHover={true} className="text-base font-extrabold text-slate-900 tracking-tight">
              MATIKS
            </GlitchText>
            <GradientText colors={['#2563eb', '#3b82f6', '#1d4ed8']} animationSpeed={6} className="text-sm font-bold tracking-tight">
              Reward Rule Engine
            </GradientText>
          </div>
        </div>
        <span className="text-slate-300">|</span>
        <span className="text-xs text-slate-500 font-medium hidden sm:inline-block">Event-driven · Config-driven · Idempotent</span>
        
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={handleFlushStore}
            disabled={flushing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Reset Redis database keys, player states, and metrics to 0"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${flushing ? 'animate-spin' : ''}`} />
            {flushing ? 'Resetting...' : 'Reset Database'}
          </button>
          
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
            {connected ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-rose-500" />
            )}
            <span className="text-xs font-semibold text-slate-600">{connected ? 'Engine Connected' : 'Connecting...'}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col gap-4 p-5 overflow-auto">
        {/* Section 1 — Pipeline Visualizer */}
        <PipelineVisualizer activeStage={activeStage} lastRewardStage={lastRewardStage} />

        {/* Section 7 — System Metrics (just below visualizer) */}
        <SystemMetrics metrics={metrics} connected={connected} />

        {/* Main 3-column layout */}
        <div className="flex flex-col lg:flex-row gap-4 min-h-[440px]">
          {/* Section 2 — Match Simulator (left) */}
          <div className="w-full lg:w-64 flex-shrink-0">
            <MatchSimulator
              selectedPlayer={selectedPlayer}
              onPlayerChange={handlePlayerChange}
              onMessage={(msg, level) =>
                pushFeed(makeFeedEntry(msg, level ?? 'info'))
              }
            />
          </div>

          {/* Section 3 — Player Counters (center) */}
          <div className="flex-1 min-w-0">
            <PlayerCounters
              playerId={selectedPlayer}
              playerState={currentPlayerState}
            />
          </div>

          {/* Section 4 — Rule Feed (right) */}
          <div className="w-full lg:w-80 flex-shrink-0">
            <RuleFeed entries={feedEntries} />
          </div>
        </div>

        {/* Section 5 — Player State Inspector (collapsible) */}
        <PlayerStateInspector playerState={currentPlayerState} />

        {/* Section 6 — Rules Config Panel (collapsible) */}
        <RulesPanel
          rules={rules}
          onRuleAdded={(rule) =>
            setRules((prev) =>
              prev.find((r) => r.id === rule.id) ? prev : [...prev, rule]
            )
          }
        />

        {/* Section 7 — Redis Cloud Live Key Explorer */}
        <RedisKeyInspector />

        {/* Section 8 — Reward Ledger (bottom) */}
        <RewardLedger entries={ledgerEntries} />
      </main>
    </div>
  );
}
