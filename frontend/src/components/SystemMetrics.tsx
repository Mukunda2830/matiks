/**
 * SystemMetrics.tsx — Section 7: System metrics strip
 *
 * Shows live counters received via WebSocket METRICS_UPDATE events:
 * events processed, rewards granted/deduped, avg eval time, connected clients.
 */
import { TrendingUp, Zap, Trophy, ShieldCheck, Clock, Plug } from 'lucide-react';
import { MetricsPayload } from '../types';
import SpotlightCard from '../reactbits/SpotlightCard';
import CountUp from '../reactbits/CountUp';

interface Props {
  metrics: MetricsPayload | null;
  connected: boolean;
}

interface MetricCardProps {
  label: string;
  value: number;
  decimals?: number;
  icon: React.ElementType;
  color?: string;
  iconBg?: string;
}

function MetricCard({ label, value, decimals = 0, icon: IconComp, color = 'text-blue-700', iconBg = 'bg-blue-50 text-blue-600 border-blue-100' }: MetricCardProps) {
  return (
    <SpotlightCard className="metric-card flex-1 min-w-[140px] bg-slate-50/80 border border-slate-200" spotlightColor="rgba(37, 99, 235, 0.08)">
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`p-1.5 rounded-lg border flex items-center justify-center ${iconBg}`}>
            <IconComp className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className={`font-mono text-2xl font-black ${color}`}>
          <CountUp to={value} decimals={decimals} />
        </div>
      </div>
    </SpotlightCard>
  );
}

export function SystemMetrics({ metrics, connected }: Props) {
  return (
    <div className="panel">
      <div className="panel-header">
        <TrendingUp className="w-4 h-4 text-blue-600" />
        <span>System Metrics</span>
        <span className={`ml-auto flex items-center gap-1.5 text-xs font-semibold normal-case tracking-normal px-2.5 py-0.5 rounded-full ${connected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          {connected ? 'Live Sync' : 'Disconnected'}
        </span>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-3">
        <MetricCard
          icon={Zap}
          label="Events Processed"
          value={metrics?.eventsProcessed ?? 0}
          color="text-blue-700"
          iconBg="bg-blue-50 text-blue-600 border-blue-100"
        />
        <MetricCard
          icon={Trophy}
          label="Rewards Granted"
          value={metrics?.rewardsGranted ?? 0}
          color="text-emerald-700"
          iconBg="bg-emerald-50 text-emerald-600 border-emerald-100"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Rewards Deduped"
          value={metrics?.rewardsDeduped ?? 0}
          color="text-amber-700"
          iconBg="bg-amber-50 text-amber-600 border-amber-100"
        />
        <MetricCard
          icon={Clock}
          label="Avg Eval (ms)"
          value={metrics?.avgEvalTimeMs ?? 0}
          decimals={2}
          color="text-purple-700"
          iconBg="bg-purple-50 text-purple-600 border-purple-100"
        />
        <MetricCard
          icon={Plug}
          label="Connected Clients"
          value={metrics?.connectedClients ?? 0}
          color="text-slate-700"
          iconBg="bg-slate-100 text-slate-600 border-slate-200"
        />
      </div>
    </div>
  );
}
