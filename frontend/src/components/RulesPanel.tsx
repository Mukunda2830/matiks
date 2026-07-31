/**
 * RulesPanel.tsx — Section 6: Collapsible rules config panel
 *
 * Shows all registered rules as human-readable cards and provides an
 * "Add New Rule" form to demonstrate that rules are data — adding one
 * requires no code changes or server restart.
 */
import { useState } from 'react';
import { Settings, ChevronDown, ChevronUp, Plus, Check, Loader2 } from 'lucide-react';
import { Rule, RuleType, RewardType, MatchResult } from '../types';
import SpotlightCard from '../reactbits/SpotlightCard';

interface Props {
  rules: Rule[];
  onRuleAdded: (rule: Rule) => void;
}

function ruleLabel(rule: Rule): string {
  const category = rule.category ? ` ${rule.category}` : '';

  const action = (() => {
    switch (rule.type) {
      case 'STREAK':
        return `IF player wins ${rule.targetCount}${category} matches in a row`;
      case 'COUNT_IN_DAY':
        return `IF player plays ${rule.targetCount}${category} matches in a day`;
      case 'COUNT_IN_WINDOW':
        return `IF player wins ${rule.targetCount}${category} matches within ${
          rule.windowSeconds ? rule.windowSeconds / 3600 : 1
        }h`;
    }
  })();

  const reward = (() => {
    if (rule.reward.type === 'COINS') return `grant ${rule.reward.amount} coins`;
    if (rule.reward.type === 'LOOT_BOX') return `grant ${rule.reward.amount} loot box`;
    if (rule.reward.type === 'MULTIPLIER')
      return `activate ${rule.reward.amount}x multiplier for ${
        rule.reward.durationSeconds ? rule.reward.durationSeconds / 60 : 30
      }min`;
    return 'grant reward';
  })();

  return `${action} THEN ${reward}`;
}

const RULE_TYPE_COLORS: Record<RuleType, string> = {
  STREAK: 'badge-blue',
  COUNT_IN_DAY: 'badge-green',
  COUNT_IN_WINDOW: 'badge-yellow',
};

function RuleCard({ rule }: { rule: Rule }) {
  return (
    <SpotlightCard className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 text-sm shadow-sm" spotlightColor="rgba(37, 99, 235, 0.08)">
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-bold text-slate-800">{rule.name}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`badge ${RULE_TYPE_COLORS[rule.type]}`}>{rule.type}</span>
            {!rule.enabled && <span className="badge badge-gray">DISABLED</span>}
          </div>
        </div>
        <p className="text-xs text-blue-700 font-mono font-semibold leading-relaxed">{ruleLabel(rule)}</p>
        {rule.description && (
          <p className="text-xs text-slate-500 mt-1 font-medium">{rule.description}</p>
        )}
        <p className="text-[10px] text-slate-400 mt-1.5 font-mono opacity-80">ID: {rule.id}</p>
      </div>
    </SpotlightCard>
  );
}

export function RulesPanel({ rules, onRuleAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<RuleType>('STREAK');
  const [targetCount, setTargetCount] = useState(3);
  const [category, setCategory] = useState('');
  const [resultFilter, setResultFilter] = useState<MatchResult | ''>('WIN');
  const [windowSeconds, setWindowSeconds] = useState(3600);
  const [rewardType, setRewardType] = useState<RewardType>('COINS');
  const [rewardAmount, setRewardAmount] = useState(25);
  const [rewardDuration, setRewardDuration] = useState(1800);

  async function addRule() {
    if (!name) return;
    setSaving(true);
    try {
      const body: Partial<Rule> = {
        name,
        description,
        type,
        targetCount,
        category: category || undefined,
        resultFilter: resultFilter || undefined,
        windowSeconds: type === 'COUNT_IN_WINDOW' ? windowSeconds : undefined,
        reward: {
          type: rewardType,
          amount: rewardAmount,
          durationSeconds: rewardType === 'MULTIPLIER' ? rewardDuration : undefined,
        },
        enabled: true,
      };

      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        onRuleAdded(data.rule);
        setShowForm(false);
        setName('');
        setDescription('');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <button
        className="panel-header w-full text-left flex items-center cursor-pointer hover:bg-slate-100/70 transition-colors py-3"
        onClick={() => setOpen((o) => !o)}
      >
        <Settings className="w-4 h-4 text-blue-600" />
        <span>Rules Config Panel</span>
        <span className="badge badge-blue ml-2">{rules.length} rules</span>
        <span className="ml-auto text-slate-400">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div className="p-4 bg-slate-50/40 border-t border-slate-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {rules.map((r) => (
              <RuleCard key={r.id} rule={r} />
            ))}
          </div>

          {!showForm ? (
            <button className="btn-secondary w-full py-2.5 flex items-center justify-center gap-2" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 text-blue-600" /> Add New Rule (Live Demo)
            </button>
          ) : (
            <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-4 shadow-sm">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">
                New Rule Config - Hot-reloaded instantly
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">Rule Name *</label>
                  <input
                    className="input"
                    placeholder="Quick Learner"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">Rule Type</label>
                  <select className="select" value={type} onChange={(e) => setType(e.target.value as RuleType)}>
                    <option value="STREAK">STREAK</option>
                    <option value="COUNT_IN_DAY">COUNT_IN_DAY</option>
                    <option value="COUNT_IN_WINDOW">COUNT_IN_WINDOW</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">Target Count</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={targetCount}
                    onChange={(e) => setTargetCount(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">Category (Optional)</label>
                  <input
                    className="input"
                    placeholder="algebra / speed / general"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">Result Filter</label>
                  <select
                    className="select"
                    value={resultFilter}
                    onChange={(e) => setResultFilter(e.target.value as MatchResult | '')}
                  >
                    <option value="">Any Result</option>
                    <option value="WIN">WIN</option>
                    <option value="LOSS">LOSS</option>
                  </select>
                </div>
                {type === 'COUNT_IN_WINDOW' && (
                  <div>
                    <label className="text-xs text-slate-600 font-semibold block mb-1">Window (seconds)</label>
                    <input
                      type="number"
                      className="input"
                      value={windowSeconds}
                      onChange={(e) => setWindowSeconds(Number(e.target.value))}
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">Reward Type</label>
                  <select
                    className="select"
                    value={rewardType}
                    onChange={(e) => setRewardType(e.target.value as RewardType)}
                  >
                    <option value="COINS">COINS</option>
                    <option value="LOOT_BOX">LOOT_BOX</option>
                    <option value="MULTIPLIER">MULTIPLIER</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-semibold block mb-1">
                    {rewardType === 'MULTIPLIER' ? 'Multiplier Value' : 'Amount'}
                  </label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={rewardAmount}
                    onChange={(e) => setRewardAmount(Number(e.target.value))}
                  />
                </div>
                {rewardType === 'MULTIPLIER' && (
                  <div>
                    <label className="text-xs text-slate-600 font-semibold block mb-1">Duration (seconds)</label>
                    <input
                      type="number"
                      className="input"
                      value={rewardDuration}
                      onChange={(e) => setRewardDuration(Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-600 font-semibold block mb-1">Description</label>
                <input
                  className="input"
                  placeholder="Optional rule description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-2.5 pt-1">
                <button className="btn-success flex-1" onClick={addRule} disabled={saving || !name}>
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Check className="w-4 h-4" /> Add Rule Live
                    </span>
                  )}
                </button>
                <button className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
