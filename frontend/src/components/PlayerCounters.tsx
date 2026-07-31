/**
 * PlayerCounters.tsx — Section 3: Live player state counters
 *
 * Shows progress bars for streak, daily count, algebra window, and
 * active multipliers. Receives live state via WebSocket PLAYER_STATE_UPDATE.
 */
import { useEffect, useState } from 'react';
import { BarChart3, Coins, Package, Zap } from 'lucide-react';
import { PlayerState, ActiveMultiplier } from '../types';
import SpotlightCard from '../reactbits/SpotlightCard';
import CountUp from '../reactbits/CountUp';

interface Props {
  playerId: string;
  playerState: PlayerState | null;
}

function ProgressBar({ value, max, color = 'bg-blue-600' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="progress-bar-container">
      <div
        className={`progress-bar-fill ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MultiplierCard({ mult }: { mult: ActiveMultiplier }) {
  const [remaining, setRemaining] = useState(mult.expiresAt - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(mult.expiresAt - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [mult.expiresAt]);

  const secs = Math.max(0, Math.floor(remaining / 1000));
  const mins = Math.floor(secs / 60);
  const secsPart = secs % 60;
  const totalDuration = mult.expiresAt - mult.grantedAt;
  const pct = Math.max(0, (remaining / totalDuration) * 100);

  return (
    <SpotlightCard className="bg-amber-50/80 border border-amber-200 rounded-xl px-3 py-2.5 shadow-sm" spotlightColor="rgba(217, 119, 6, 0.12)">
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
            {mult.multiplier}x Multiplier Active
          </span>
          <span className="font-mono text-xs font-semibold text-amber-700">
            {secs <= 0 ? 'Expired' : `${mins}m ${secsPart.toString().padStart(2, '0')}s`}
          </span>
        </div>
        <div className="progress-bar-container">
          <div
            className="progress-bar-fill bg-amber-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </SpotlightCard>
  );
}

export function PlayerCounters({ playerId, playerState }: Props) {
  // Window count state — fetch algebra window data from playerState
  const windowedAlgebraCount = playerState?.windowedMatches?.filter(
    (m) => m.category === 'algebra' && m.result === 'WIN'
  ).length ?? 0;

  const activeMultipliers =
    playerState?.activeMultipliers?.filter((m) => m.expiresAt > Date.now()) ?? [];

  return (
    <div className="panel flex flex-col h-[440px] max-h-[440px]">
      <div className="panel-header flex-shrink-0">
        <BarChart3 className="w-4 h-4 text-blue-600" />
        <span>Player Counters</span>
        <span className="ml-auto badge badge-blue font-mono font-bold">{playerId}</span>
      </div>
      <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto custom-scrollbar">
        {!playerState ? (
          <p className="text-slate-400 text-sm text-center py-8">
            Simulate a match to view real-time player counters
          </p>
        ) : (
          <>
            {/* Win Streak */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Win Streak</span>
                <span className="font-mono text-sm font-bold text-slate-700">
                  <span className="text-blue-600 font-extrabold">{playerState.currentStreak}</span>
                  <span className="text-slate-400"> / 3</span>
                </span>
              </div>
              <ProgressBar value={playerState.currentStreak} max={3} color="bg-blue-600" />
              <p className="text-[11px] text-slate-500 mt-1">Resets on LOSS · Fires reward at 3 wins</p>
            </div>

            {/* Matches played today */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Matches Today</span>
                <span className="font-mono text-sm font-bold text-slate-700">
                  <span className="text-emerald-600 font-extrabold">{playerState.dailyMatchCount}</span>
                  <span className="text-slate-400"> / 5</span>
                </span>
              </div>
              <ProgressBar value={playerState.dailyMatchCount} max={5} color="bg-emerald-600" />
              <p className="text-[11px] text-slate-500 mt-1">Resets daily at midnight · Fires reward at 5 matches</p>
            </div>

            {/* Algebra wins in last hour */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Algebra Wins (1h window)</span>
                <span className="font-mono text-sm font-bold text-slate-700">
                  <span className="text-amber-600 font-extrabold">{windowedAlgebraCount}</span>
                  <span className="text-slate-400"> / 2</span>
                </span>
              </div>
              <ProgressBar value={windowedAlgebraCount} max={2} color="bg-amber-500" />
              <p className="text-[11px] text-slate-500 mt-1">Sliding 1-hour window · Expires per-event timestamp</p>
            </div>

            {/* Inventory */}
            <div className="grid grid-cols-2 gap-3">
              <SpotlightCard className="bg-blue-50/50 border border-blue-100 rounded-xl px-3.5 py-3 text-center shadow-sm" spotlightColor="rgba(37, 99, 235, 0.1)">
                <div className="relative z-10 flex flex-col items-center">
                  <div className="p-1.5 bg-blue-100/80 rounded-lg text-blue-600 mb-1">
                    <Coins className="w-5 h-5" />
                  </div>
                  <div className="font-mono text-xl font-extrabold text-blue-700">
                    <CountUp to={playerState.inventory.coins} />
                  </div>
                  <div className="text-xs font-semibold text-slate-500">Coins Balance</div>
                </div>
              </SpotlightCard>
              <SpotlightCard className="bg-emerald-50/50 border border-emerald-100 rounded-xl px-3.5 py-3 text-center shadow-sm" spotlightColor="rgba(22, 163, 74, 0.1)">
                <div className="relative z-10 flex flex-col items-center">
                  <div className="p-1.5 bg-emerald-100/80 rounded-lg text-emerald-600 mb-1">
                    <Package className="w-5 h-5" />
                  </div>
                  <div className="font-mono text-xl font-extrabold text-emerald-700">
                    <CountUp to={playerState.inventory.lootBoxes} />
                  </div>
                  <div className="text-xs font-semibold text-slate-500">Loot Boxes</div>
                </div>
              </SpotlightCard>
            </div>

            {/* Active Multipliers */}
            {activeMultipliers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Active Multipliers
                </p>
                <div className="flex flex-col gap-2">
                  {activeMultipliers.map((m) => (
                    <MultiplierCard key={m.id} mult={m} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
