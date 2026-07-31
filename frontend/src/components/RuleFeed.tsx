/**
 * RuleFeed.tsx — Section 4: Color-coded live event log with fixed scrollbox
 *
 * A scrolling feed that color-codes events by type:
 *   slate   = informational (match received, counters updated)
 *   emerald = reward granted
 *   amber   = reward deduped (idempotency caught a duplicate)
 *   rose    = errors
 */
import { useEffect, useRef } from 'react';
import { Radio, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { FeedEntry } from '../types';

interface Props {
  entries: FeedEntry[];
}

const LEVEL_STYLES: Record<FeedEntry['level'], string> = {
  info: 'text-slate-600 border-l-slate-300 bg-slate-50/70 hover:bg-slate-100/80',
  success: 'text-emerald-700 border-l-emerald-500 bg-emerald-50/50 hover:bg-emerald-50/80',
  warning: 'text-amber-700 border-l-amber-500 bg-amber-50/50 hover:bg-amber-50/80',
  error: 'text-rose-700 border-l-rose-500 bg-rose-50/50 hover:bg-rose-50/80',
};

const LEVEL_ICONS: Record<FeedEntry['level'], React.ElementType> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function RuleFeed({ entries }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div className="panel flex flex-col h-[440px] max-h-[440px]">
      <div className="panel-header flex-shrink-0">
        <Radio className="w-4 h-4 text-blue-600 animate-pulse" />
        <span>Rule Event Feed</span>
        <span className="ml-auto text-slate-500 text-xs font-semibold normal-case tracking-normal bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
          {entries.length} events
        </span>
      </div>
      
      {/* Scrollable event list box with constrained height */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5 min-h-0 bg-slate-50/40 custom-scrollbar">
        {entries.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-400 text-center font-sans text-sm">
              Waiting for live engine events...
            </p>
          </div>
        )}
        {entries.map((entry) => {
          const IconComp = LEVEL_ICONS[entry.level];
          return (
            <div
              key={entry.id}
              className={`feed-entry pl-3 border-l-2 py-2 pr-2.5 rounded-r-lg shadow-sm transition-all ${LEVEL_STYLES[entry.level]}`}
            >
              <div className="flex items-start gap-2">
                <IconComp className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="break-words font-medium">{entry.message}</span>
                  {entry.detail && (
                    <div className="text-slate-500 text-[11px] mt-0.5 break-all font-mono opacity-90">{entry.detail}</div>
                  )}
                </div>
                <span className="flex-shrink-0 text-slate-400 font-mono text-[10px]">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
