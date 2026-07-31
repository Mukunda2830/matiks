import { KeyValueStore } from '../store/KeyValueStore';
import { EventBus } from '../domain/EventBus';
import { MatchCompletedEvent, Rule, RewardTriggeredEvent, MatchResult } from '../domain/models';
import { RuleIndexer } from './RuleIndexer';
import { RuleStrategy, StrategyEvaluationResult } from './strategies/RuleStrategy';
import { StreakRuleStrategy } from './strategies/StreakRuleStrategy';
import { CountInDayRuleStrategy } from './strategies/CountInDayRuleStrategy';
import { CountInWindowRuleStrategy } from './strategies/CountInWindowRuleStrategy';

export interface EvaluationTrace {
  matchEvent: MatchCompletedEvent;
  candidateRules: Rule[];
  evaluations: StrategyEvaluationResult[];
  triggeredRewards: RewardTriggeredEvent[];
  evaluatedAt: number;
  executionTimeMs: number;
}

export class RuleEngine {
  private indexer: RuleIndexer;
  private strategies = new Map<string, RuleStrategy>();

  constructor(
    private store: KeyValueStore,
    private eventBus: EventBus,
    indexer?: RuleIndexer
  ) {
    this.indexer = indexer || new RuleIndexer();

    const streakStrat = new StreakRuleStrategy();
    const dayStrat = new CountInDayRuleStrategy();
    const windowStrat = new CountInWindowRuleStrategy();

    this.strategies.set(streakStrat.type, streakStrat);
    this.strategies.set(dayStrat.type, dayStrat);
    this.strategies.set(windowStrat.type, windowStrat);
  }

  public async registerRule(rule: Rule): Promise<void> {
    this.indexer.registerRule(rule);
    await this.store.sAdd('rules:all_ids', rule.id);
    await this.store.set(`rules:data:${rule.id}`, JSON.stringify(rule));
  }

  public async loadRulesFromStore(): Promise<number> {
    const ruleIds = await this.store.sMembers('rules:all_ids');
    let loaded = 0;
    for (const id of ruleIds) {
      const data = await this.store.get(`rules:data:${id}`);
      if (data) {
        try {
          const rule: Rule = JSON.parse(data);
          this.indexer.registerRule(rule);
          loaded++;
        } catch {}
      }
    }
    return loaded;
  }

  public unregisterRule(ruleId: string): boolean {
    this.store.sRem('rules:all_ids', ruleId);
    this.store.del(`rules:data:${ruleId}`);
    return this.indexer.unregisterRule(ruleId);
  }

  public clear(): void {
    this.indexer.clear();
  }

  public getCandidateRules(category: string, result: MatchResult): Rule[] {
    return this.indexer.getCandidateRules(category, result);
  }

  public getAllRules(): Rule[] {
    return this.indexer.getAllRules();
  }

  public getIndexer(): RuleIndexer {
    return this.indexer;
  }

  public async evaluateMatch(event: MatchCompletedEvent): Promise<EvaluationTrace> {
    const startTime = performance.now();
    const candidateRules = this.indexer.getCandidateRules(event.category, event.result);
    const evaluations: StrategyEvaluationResult[] = [];
    const triggeredRewards: RewardTriggeredEvent[] = [];

    for (const rule of candidateRules) {
      const strategy = this.strategies.get(rule.type);
      if (!strategy) {
        continue;
      }

      const evalResult = await strategy.evaluate(rule, event, this.store);
      evaluations.push(evalResult);

      if (evalResult.triggered && evalResult.idempotencyKey) {
        const triggeredEvent: RewardTriggeredEvent = {
          eventId: `rte_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          ruleId: rule.id,
          ruleName: rule.name,
          playerId: event.playerId,
          reward: rule.reward,
          idempotencyKey: evalResult.idempotencyKey,
          triggeredAt: Date.now(),
          matchEventId: event.eventId,
        };

        triggeredRewards.push(triggeredEvent);
        this.eventBus.emit('RewardTriggered', triggeredEvent);
      }
    }

    const executionTimeMs = performance.now() - startTime;

    return {
      matchEvent: event,
      candidateRules,
      evaluations,
      triggeredRewards,
      evaluatedAt: Date.now(),
      executionTimeMs,
    };
  }
}
