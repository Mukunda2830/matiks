import { RuleStrategy, StrategyEvaluationResult } from './RuleStrategy';
import { MatchCompletedEvent, Rule } from '../../domain/models';
import { KeyValueStore } from '../../store/KeyValueStore';

export class CountInWindowRuleStrategy implements RuleStrategy {
  readonly type = 'COUNT_IN_WINDOW';

  public async evaluate(
    rule: Rule,
    event: MatchCompletedEvent,
    store: KeyValueStore
  ): Promise<StrategyEvaluationResult> {
    const windowSeconds = rule.windowSeconds ?? 3600;
    const counterKey = `player:${event.playerId}:window:${rule.id}`;

    if (rule.category && rule.category.toLowerCase() !== event.category.toLowerCase()) {
      const members = await store.sMembers(counterKey);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered: false,
        currentCount: members.length,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Category mismatch',
      };
    }

    if (rule.resultFilter && rule.resultFilter !== event.result) {
      const members = await store.sMembers(counterKey);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: this.type,
        triggered: false,
        currentCount: members.length,
        targetCount: rule.targetCount,
        counterKey,
        reason: 'Result filter mismatch',
      };
    }

    // Retrieve existing set members
    const members = await store.sMembers(counterKey);
    const cutoff = event.timestamp - windowSeconds * 1000;
    const validMembers: string[] = [];
    const expiredMembers: string[] = [];

    for (const m of members) {
      let ts: number | null = null;
      try {
        if (m.startsWith('{')) {
          const parsed = JSON.parse(m);
          ts = typeof parsed.timestamp === 'number' ? parsed.timestamp : null;
        } else if (m.includes(':')) {
          const parts = m.split(':');
          ts = parseInt(parts[0], 10);
        } else {
          ts = parseInt(m, 10);
        }
      } catch {
        ts = null;
      }

      if (ts !== null && ts >= cutoff) {
        validMembers.push(m);
      } else {
        expiredMembers.push(m);
      }
    }

    // Purge expired members outside window
    if (expiredMembers.length > 0) {
      await store.sRem(counterKey, expiredMembers);
    }

    // Add current event member to Set
    const newMemberStr = JSON.stringify({
      matchId: event.matchId,
      category: event.category,
      result: event.result,
      timestamp: event.timestamp,
    });
    await store.sAdd(counterKey, newMemberStr, windowSeconds);

    const activeCount = validMembers.length + 1;
    const triggered = activeCount >= rule.targetCount;

    // Generate idempotency key based on time bucket
    const timeBucket = Math.floor(event.timestamp / (windowSeconds * 1000));
    const idempotencyKey = `${event.playerId}:${rule.id}:${timeBucket}`;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: this.type,
      triggered,
      currentCount: activeCount,
      targetCount: rule.targetCount,
      idempotencyKey,
      counterKey,
      ttlSeconds: windowSeconds,
    };
  }
}
