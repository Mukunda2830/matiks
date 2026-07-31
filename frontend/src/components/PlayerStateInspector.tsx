/**
 * PlayerStateInspector.tsx — Section 5: Collapsible raw JSON state view
 *
 * Shows the raw internal player state object — streaks, daily counts,
 * windowed events. Useful for pointing at live data during a demo.
 */
import { useState } from 'react';
import { Microscope, ChevronDown, ChevronUp } from 'lucide-react';
import { PlayerState } from '../types';

interface Props {
  playerState: PlayerState | null;
}

export function PlayerStateInspector({ playerState }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel">
      <button
        className="panel-header w-full text-left flex items-center cursor-pointer hover:bg-slate-100/70 transition-colors py-3"
        onClick={() => setOpen((o) => !o)}
      >
        <Microscope className="w-4 h-4 text-blue-600" />
        <span>Player State Inspector</span>
        <span className="ml-1.5 text-slate-500 text-xs font-normal normal-case tracking-normal">
          - raw internal state
        </span>
        <span className="ml-auto text-slate-400">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div className="p-4 bg-slate-50/50 border-t border-slate-100">
          {!playerState ? (
            <p className="text-slate-400 text-sm text-center py-4">No state recorded yet — simulate a match first</p>
          ) : (
            <pre className="font-mono text-xs text-slate-800 bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto max-h-64 overflow-y-auto leading-relaxed shadow-inner">
              {JSON.stringify(playerState, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
