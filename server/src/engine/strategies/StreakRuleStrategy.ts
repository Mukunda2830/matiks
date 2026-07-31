import { RuleStrategy, StrategyEvaluationResult } from './RuleStrategy';
import { MatchCompletedEvent, Rule } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export class StreakRuleStrategy implements RuleStrategy {
  readonly type = 'STREAK';

  public async evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<StrategyEvaluationResult> {
    const counterKey = `player:${event.playerId}:streak:${rule.id}`;
    const globalStreakKey = `player:${event.playerId}:streak`;

    // Category filter check if category is specified on the rule
    if (rule.category && rule.category.toLowerCase() !== event.category.toLowerCase()) {
      const currentVal = await store.get(counterKey);
      const currentCount = currentVal ? parseInt(currentVal, 10) : 0;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered: false,
        currentCount,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Category mismatch',
      };
    }

    const requiredResult = rule.resultFilter ?? 'WIN';
    const cycleKey = `player:${event.playerId}:streakcycle:${rule.id}`;

    if (event.result === requiredResult) {
      const newCount = await store.incrBy(counterKey, 1);
      await store.set(globalStreakKey, newCount.toString());

      const cycleVal = await store.get(cycleKey);
      const cycle = cycleVal ? parseInt(cycleVal, 10) : 1;
      const streakStep = Math.floor(newCount / rule.targetCount);

      const triggered = newCount >= rule.targetCount;
      const idempotencyKey = `${event.playerId}:${rule.id}:cycle:${cycle}:step:${streakStep}`;

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered,
        currentCount: newCount,
        targetCount: rule.targetCount,
        idempotencyKey,
        counterKey,
      };
    } else {
      // Non-matching result (e.g. LOSS or DRAW) resets the streak counter to 0 and increments cycle
      await store.set(counterKey, '0');
      await store.set(globalStreakKey, '0');

      const cycleVal = await store.get(cycleKey);
      const currentCycle = cycleVal ? parseInt(cycleVal, 10) : 1;
      await store.set(cycleKey, (currentCycle + 1).toString());

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered: false,
        currentCount: 0,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Streak broken by non-matching result',
      };
    }
  }
}
