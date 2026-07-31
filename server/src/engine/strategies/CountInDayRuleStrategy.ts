import { RuleStrategy, StrategyEvaluationResult } from './RuleStrategy';
import { MatchCompletedEvent, Rule } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export class CountInDayRuleStrategy implements RuleStrategy {
  readonly type = 'COUNT_IN_DAY';

  public async evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<StrategyEvaluationResult> {
    if (rule.category && rule.category.toLowerCase() !== event.category.toLowerCase()) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        reason: 'Category mismatch',
      };
    }

    if (rule.resultFilter && rule.resultFilter !== event.result) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        reason: 'Result filter mismatch',
      };
    }

    const dateStr = new Date(event.timestamp).toISOString().split('T')[0];
    const counterKey = `player:${event.playerId}:daily:${rule.id}:${dateStr}`;
    const globalDailyKey = `player:${event.playerId}:daily:${dateStr}`;
    const ttlSeconds = 86400; // 24 hours

    const newCount = await store.incrBy(counterKey, 1, ttlSeconds);
    await store.incrBy(globalDailyKey, 1, ttlSeconds);

    const triggered = newCount >= rule.targetCount;
    const idempotencyKey = `${event.playerId}:${rule.id}:${dateStr}`;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: this.type,
      triggered,
      currentCount: newCount,
      targetCount: rule.targetCount,
      idempotencyKey,
      counterKey,
      ttlSeconds,
    };
  }
}
