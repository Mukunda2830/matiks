import { Rule, MatchResult, RuleType } from '../domain/models';

export class RuleIndexer {
  private rulesMap = new Map<string, Rule>();
  private index = new Map<string, Rule[]>();

  private makeIndexKey(category?: string, resultFilter?: MatchResult, type?: RuleType): string {
    const c = category && category.trim() !== '' ? category.toLowerCase() : '*';
    const r = (type === 'STREAK' || !resultFilter || resultFilter.trim() === '') ? '*' : resultFilter;
    return `${c}:${r}`;
  }

  public registerRule(rule: Rule): void {
    // If updating existing rule, unregister old index entries first
    if (this.rulesMap.has(rule.id)) {
      this.unregisterRule(rule.id);
    }

    this.rulesMap.set(rule.id, rule);
    const key = this.makeIndexKey(rule.category, rule.resultFilter, rule.type);

    let ruleList = this.index.get(key);
    if (!ruleList) {
      ruleList = [];
      this.index.set(key, ruleList);
    }
    ruleList.push(rule);
  }

  public unregisterRule(ruleId: string): boolean {
    const rule = this.rulesMap.get(ruleId);
    if (!rule) return false;

    const key = this.makeIndexKey(rule.category, rule.resultFilter, rule.type);
    const ruleList = this.index.get(key);
    if (ruleList) {
      const idx = ruleList.indexOf(rule);
      if (idx !== -1) {
        ruleList.splice(idx, 1);
      }
    }
    return this.rulesMap.delete(ruleId);
  }

  public getCandidateRules(category: string, result: MatchResult): Rule[] {
    const cat = category && category.trim() !== '' ? category.toLowerCase() : '*';
    const res = result && result.trim() !== '' ? result : '*';

    let keysToQuery: string[];
    if (cat === '*' && res === '*') {
      keysToQuery = ['*:*'];
    } else if (cat === '*') {
      keysToQuery = [`*:${res}`, '*:*'];
    } else if (res === '*') {
      keysToQuery = [`${cat}:*`, '*:*'];
    } else {
      keysToQuery = [`${cat}:${res}`, `${cat}:*`, `*:${res}`, '*:*'];
    }

    const candidateRules: Rule[] = [];

    for (let k = 0; k < keysToQuery.length; k++) {
      const list = this.index.get(keysToQuery[k]);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].enabled) {
            candidateRules.push(list[i]);
          }
        }
      }
    }

    return candidateRules;
  }

  public getAllRules(): Rule[] {
    return Array.from(this.rulesMap.values());
  }

  public getRule(ruleId: string): Rule | undefined {
    return this.rulesMap.get(ruleId);
  }

  public clear(): void {
    this.rulesMap.clear();
    this.index.clear();
  }
}

