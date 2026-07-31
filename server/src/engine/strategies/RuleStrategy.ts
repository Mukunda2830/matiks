import { MatchCompletedEvent, Rule, RuleType } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export interface StrategyEvaluationResult {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  triggered: boolean;
  currentCount: number;
  targetCount: number;
  idempotencyKey?: string;
  reason?: string;
  counterKey?: string;
  ttlSeconds?: number;
}

export interface RuleStrategy {
  readonly type: RuleType;
  evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<StrategyEvaluationResult>;
}
