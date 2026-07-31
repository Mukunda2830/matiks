/**
 * MatchSimulator.tsx — Section 2: Left sidebar match input panel
 *
 * Controls for triggering single matches and bursts on any player.
 * All calls go to the backend REST API; Socket.IO events drive the
 * visualizer and feed automatically.
 */
import React, { useState } from 'react';
import { Target, Check, X, Play, Zap, Flame, Calendar, Calculator, Repeat, Loader2 } from 'lucide-react';

const PLAYERS = ['player_1', 'player_2', 'player_3'];
const CATEGORIES = ['algebra', 'speed', 'general'];

interface Props {
  onMessage: (msg: string, level?: 'info' | 'success' | 'warning') => void;
  selectedPlayer: string;
  onPlayerChange: (p: string) => void;
}

export function MatchSimulator({ onMessage, selectedPlayer, onPlayerChange }: Props) {
  const [result, setResult] = useState<'WIN' | 'LOSS'>('WIN');
  const [category, setCategory] = useState('algebra');
  const [burstCount, setBurstCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [burstLoading, setBurstLoading] = useState(false);

  async function simulateMatch() {
    setLoading(true);
    try {
      const res = await fetch('/api/simulate-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: selectedPlayer, result, category }),
      });
      const data = await res.json();
      if (!res.ok) {
        onMessage(`Error: ${data.error}`, 'warning');
      } else {
        onMessage(
          `Match simulated: ${selectedPlayer} ${result} in ${category} (${data.trace.executionTimeMs}ms)`,
          'info'
        );
      }
    } catch {
      onMessage('Failed to reach server', 'warning');
    } finally {
      setLoading(false);
    }
  }

  async function simulateBurst() {
    setBurstLoading(true);
    try {
      const res = await fetch('/api/simulate-burst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: selectedPlayer,
          count: burstCount,
          result,
          category,
        }),
      });
      const data = await res.json();
      onMessage(data.message || `Burst of ${burstCount} queued`, 'info');
    } catch {
      onMessage('Failed to reach server', 'warning');
    } finally {
      setBurstLoading(false);
    }
  }

  return (
    <div className="panel flex flex-col h-[440px] max-h-[440px]">
      <div className="panel-header flex-shrink-0">
        <Target className="w-4 h-4 text-blue-600" />
        <span>Match Simulator</span>
      </div>
      <div className="p-4 flex flex-col gap-3.5 flex-1 overflow-y-auto custom-scrollbar">
        {/* Player selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
            Target Player
          </label>
          <select
            className="select font-mono"
            value={selectedPlayer}
            onChange={(e) => onPlayerChange(e.target.value)}
          >
            {PLAYERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Result toggle */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
            Match Result
          </label>
          <div className="flex rounded-lg overflow-hidden border border-slate-200 p-0.5 bg-slate-100/70">
            {(['WIN', 'LOSS'] as const).map((r) => (
              <button
                key={r}
                className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
                  result === r
                    ? r === 'WIN'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
                onClick={() => setResult(r)}
              >
                {r === 'WIN' ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Win
                  </>
                ) : (
                  <>
                    <X className="w-3.5 h-3.5" /> Loss
                  </>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Category selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
            Game Category
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  category === c
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 flex flex-col gap-2.5">
          {/* Simulate single match */}
          <button className="btn-primary w-full" onClick={simulateMatch} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Simulating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Play className="w-4 h-4 fill-current" />
                Simulate Match
              </span>
            )}
          </button>

          {/* Burst controls */}
          <div className="flex gap-2">
            <input
              type="number"
              className="input w-16 text-center font-mono font-bold"
              min={1}
              max={20}
              value={burstCount}
              onChange={(e) => setBurstCount(Number(e.target.value))}
            />
            <button
              className="btn-secondary flex-1"
              onClick={simulateBurst}
              disabled={burstLoading}
            >
              {burstLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Bursting...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" /> Burst x{burstCount}
                </span>
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            Burst fires matches 200ms apart — ideal for testing streaks and idempotency.
          </p>
        </div>

        {/* Quick tips */}
        <div className="mt-auto pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Quick Demo Tips</p>
          <ul className="text-xs text-slate-600 space-y-1.5 font-medium">
            <li className="flex items-center gap-2">
              <Flame className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span>Win 3x &rarr; Streak coins</span>
            </li>
            <li className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <span>Burst 5 &rarr; Daily loot box</span>
            </li>
            <li className="flex items-center gap-2">
              <Calculator className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
              <span>Win 2 algebra &rarr; 2x multiplier</span>
            </li>
            <li className="flex items-center gap-2">
              <Repeat className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              <span>Duplicate events &rarr; Idempotency dedup</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
