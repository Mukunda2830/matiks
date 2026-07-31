import React from 'react';
import { Gamepad2, Search, BarChart3, Zap, Trophy, ShieldCheck, Workflow, ArrowRight } from 'lucide-react';
import { PipelineStage } from '../types';
import StarBorder from '../reactbits/StarBorder';

interface Stage {
  id: PipelineStage;
  label: string;
  icon: React.ElementType;
}

const STAGES: Stage[] = [
  { id: 'MATCH_RECEIVED', label: 'Match Event', icon: Gamepad2 },
  { id: 'RULE_CANDIDATES_FOUND', label: 'Rule Evaluator', icon: Search },
  { id: 'COUNTERS_UPDATED', label: 'Player Counters', icon: BarChart3 },
  { id: 'THRESHOLD_MET', label: 'Threshold Check', icon: Zap },
  { id: 'REWARD_GRANTED', label: 'Reward Dispatcher', icon: Trophy },
  { id: 'REWARD_DEDUPED', label: 'Dedup (Idempotency)', icon: ShieldCheck },
];

interface Props {
  activeStage: PipelineStage;
  lastRewardStage: 'REWARD_GRANTED' | 'REWARD_DEDUPED' | null;
}

export function PipelineVisualizer({ activeStage, lastRewardStage }: Props) {
  return (
    <div className="panel">
      <div className="panel-header">
        <Workflow className="w-4 h-4 text-blue-600" />
        <span>Pipeline Visualizer</span>
        <span className="ml-auto text-slate-500 text-xs font-normal normal-case tracking-normal">
          Events flow left to right in real time
        </span>
      </div>
      <div className="px-5 py-4 flex items-center gap-2 overflow-x-auto">
        {STAGES.map((stage, idx) => {
          const IconComponent = stage.icon;
          const isActive = activeStage === stage.id;
          const isRewardGranted =
            stage.id === 'REWARD_GRANTED' && lastRewardStage === 'REWARD_GRANTED';
          const isRewardDeduped =
            stage.id === 'REWARD_DEDUPED' && lastRewardStage === 'REWARD_DEDUPED';

          let stageClass = 'pipeline-stage';
          if (isActive) stageClass += ' active';
          if (isRewardGranted || isRewardDeduped) stageClass += ' reward';

          const content = (
            <div className={stageClass}>
              <IconComponent className={`w-5 h-5 mb-1.5 ${
                isActive
                  ? 'text-blue-600'
                  : isRewardGranted
                  ? 'text-emerald-600'
                  : isRewardDeduped
                  ? 'text-amber-600'
                  : 'text-slate-500'
              }`} />
              <span
                className={`text-xs font-bold ${
                  isActive
                    ? 'text-blue-700'
                    : isRewardGranted
                    ? 'text-emerald-700'
                    : isRewardDeduped
                    ? 'text-amber-700'
                    : 'text-slate-600'
                }`}
              >
                {stage.label}
              </span>
              {isActive && (
                <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-600 animate-pulse-fast block mx-auto" />
              )}
            </div>
          );

          return (
            <React.Fragment key={stage.id}>
              {isActive ? (
                <StarBorder color="#2563eb" thickness={1.5} speed="3s" className="flex-1 min-w-[110px]">
                  {content}
                </StarBorder>
              ) : isRewardGranted ? (
                <StarBorder color="#16a34a" thickness={1.5} speed="2s" className="flex-1 min-w-[110px]">
                  {content}
                </StarBorder>
              ) : isRewardDeduped ? (
                <StarBorder color="#d97706" thickness={1.5} speed="2s" className="flex-1 min-w-[110px]">
                  {content}
                </StarBorder>
              ) : (
                content
              )}
              {idx < STAGES.length - 1 && (
                <div
                  className={`flex-shrink-0 transition-colors duration-300 ${
                    isActive ? 'text-blue-600' : 'text-slate-300'
                  }`}
                >
                  <ArrowRight className="w-4 h-4" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
