/**
 * RedisKeyInspector.tsx — Live Redis Cloud Key Explorer
 *
 * Fetches and displays all live keys stored in the Redis Cloud database.
 * No external app or CLI download required!
 */
import { useEffect, useState, useCallback } from 'react';
import { Database, RefreshCw, ChevronDown, ChevronUp, Key, HardDrive } from 'lucide-react';
import SpotlightCard from '../reactbits/SpotlightCard';

interface KeyDetail {
  key: string;
  type: string;
  ttl: number;
  value: any;
}

interface StoreStatusResponse {
  mode: string;
  isRealRedis: boolean;
  count: number;
  keys: KeyDetail[];
}

export function RedisKeyInspector() {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StoreStatusResponse | null>(null);

  const fetchKeys = useCallback(() => {
    setLoading(true);
    fetch('/api/store/keys')
      .then((r) => r.json())
      .then((res: StoreStatusResponse) => {
        setData(res);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  return (
    <div className="panel">
      <div
        className="panel-header w-full text-left flex items-center cursor-pointer hover:bg-slate-100/70 transition-colors py-3 select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <Database className="w-4 h-4 text-blue-600" />
        <span>Redis Cloud Live Key Explorer</span>
        {data && (
          <span className={`badge ml-2 font-mono ${data.isRealRedis ? 'badge-green' : 'badge-yellow'}`}>
            {data.isRealRedis ? 'Redis Cloud Connected' : 'In-Memory Fallback'}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            className="p-1 rounded-md hover:bg-slate-200/80 text-slate-500 hover:text-slate-900 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              fetchKeys();
            }}
            title="Refresh keys from Redis Cloud"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
          <span className="text-slate-400">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </span>
      </div>

      {open && (
        <div className="p-4 bg-slate-50/40 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
            <span className="font-semibold flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-blue-600" />
              Live Database Instance: <span className="font-mono text-slate-700">mild-vertical-cabbage-69067.db.redis.io:11173</span>
            </span>
            <span className="font-mono font-bold text-slate-700">
              {data?.count ?? 0} keys stored
            </span>
          </div>

          {!data || data.keys.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6 font-sans">
              No keys in database — simulate a match to see keys created in Redis Cloud!
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left">Redis Key</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">TTL</th>
                    <th className="px-3 py-2 text-left">Stored Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.keys.map((k) => (
                    <tr key={k.key} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-3 py-2 font-mono font-bold text-blue-700 flex items-center gap-1.5">
                        <Key className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        <span className="break-all">{k.key}</span>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        <span className={`badge ${k.type === 'set' ? 'badge-blue' : 'badge-gray'}`}>
                          {k.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {k.ttl === -1 ? 'infinity' : k.ttl === -2 ? 'expired' : `${k.ttl}s`}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-800 max-w-[320px] truncate" title={typeof k.value === 'object' ? JSON.stringify(k.value) : String(k.value)}>
                        {typeof k.value === 'object' ? JSON.stringify(k.value) : String(k.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
