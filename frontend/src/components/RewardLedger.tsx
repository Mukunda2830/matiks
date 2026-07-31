/**
 * RewardLedger.tsx — Section 8: Sortable reward ledger table
 *
 * Shows all reward grants and deduplication events, sortable by any column.
 * Color-coded by status: green = GRANTED, yellow = DEDUPED.
 */
import { useState } from 'react';
import { ClipboardList, Coins, Package, Zap, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { LedgerEntry, RewardType } from '../types';

interface Props {
  entries: LedgerEntry[];
}

type SortKey = keyof Pick<LedgerEntry, 'playerId' | 'ruleName' | 'grantedAt' | 'status'>;

const REWARD_ICONS: Record<RewardType, React.ElementType> = {
  COINS: Coins,
  LOOT_BOX: Package,
  MULTIPLIER: Zap,
};

export function RewardLedger({ entries }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('grantedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...entries].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-slate-300 inline ml-1" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-blue-600 inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-600 inline ml-1" />
    );
  }

  function th(label: string, key: SortKey) {
    return (
      <th
        className="px-3.5 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500 cursor-pointer hover:text-slate-900 transition-colors select-none"
        onClick={() => toggleSort(key)}
      >
        <span className="inline-flex items-center">
          {label} <SortIcon col={key} />
        </span>
      </th>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <ClipboardList className="w-4 h-4 text-blue-600" />
        <span>Reward Ledger</span>
        <span className="badge badge-blue ml-2">{entries.length} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80">
            <tr>
              {th('Player', 'playerId')}
              {th('Rule', 'ruleName')}
              <th className="px-3.5 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                Reward
              </th>
              {th('Status', 'status')}
              {th('Timestamp', 'grantedAt')}
              <th className="px-3.5 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                Idempotency Key
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400 text-sm font-sans">
                  No reward records found yet — simulate matches to populate ledger
                </td>
              </tr>
            )}
            {sorted.map((entry) => {
              const RewardIconComp = REWARD_ICONS[entry.reward.type];
              return (
                <tr
                  key={entry.id}
                  className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                >
                  <td className="px-3.5 py-2.5 font-mono text-xs font-semibold text-slate-800">{entry.playerId}</td>
                  <td className="px-3.5 py-2.5 text-xs text-slate-700 max-w-[200px] truncate font-medium" title={entry.ruleName}>
                    {entry.ruleName}
                  </td>
                  <td className="px-3.5 py-2.5 text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <RewardIconComp className={`w-3.5 h-3.5 ${
                        entry.reward.type === 'COINS' ? 'text-amber-500' : entry.reward.type === 'LOOT_BOX' ? 'text-emerald-500' : 'text-blue-500'
                      }`} />
                      <span>
                        {entry.reward.amount}
                        {entry.reward.type === 'MULTIPLIER' ? 'x' : ''}{' '}
                        {entry.reward.type.replace('_', ' ').toLowerCase()}
                      </span>
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className={`badge ${
                        entry.status === 'GRANTED' ? 'badge-green' : 'badge-yellow'
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-xs text-slate-500">
                    {new Date(entry.grantedAt).toLocaleTimeString()}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-400 max-w-[220px] truncate" title={entry.idempotencyKey}>
                    {entry.idempotencyKey}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
