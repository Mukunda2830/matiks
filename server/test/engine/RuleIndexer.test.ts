import { describe, it, expect, beforeEach } from 'vitest';
import { RuleIndexer } from '../../src/engine/RuleIndexer';
import { Rule } from '../../src/domain/models';

describe('RuleIndexer Test Suite', () => {
  let indexer: RuleIndexer;

  beforeEach(() => {
    indexer = new RuleIndexer();
  });

  const ruleExact: Rule = {
    id: 'rule_exact',
    name: 'Algebra Win',
    description: 'Win an algebra match',
    type: 'STREAK',
    targetCount: 1,
    category: 'algebra',
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 10 },
    enabled: true,
    createdAt: Date.now(),
  };

  const ruleResultWildcard: Rule = {
    id: 'rule_res_wildcard',
    name: 'Algebra Any Play',
    description: 'Play any algebra match',
    type: 'COUNT_IN_DAY',
    targetCount: 1,
    category: 'algebra',
    reward: { type: 'COINS', amount: 5 },
    enabled: true,
    createdAt: Date.now(),
  };

  const ruleCatWildcard: Rule = {
    id: 'rule_cat_wildcard',
    name: 'Win Any Category',
    description: 'Win any match',
    type: 'STREAK',
    targetCount: 3,
    resultFilter: 'WIN',
    reward: { type: 'COINS', amount: 50 },
    enabled: true,
    createdAt: Date.now(),
  };

  const ruleDoubleWildcard: Rule = {
    id: 'rule_double_wildcard',
    name: 'Play Any Match',
    description: 'Play any match in any category',
    type: 'COUNT_IN_DAY',
    targetCount: 5,
    reward: { type: 'LOOT_BOX', amount: 1 },
    enabled: true,
    createdAt: Date.now(),
  };

  it('indexes and retrieves exact category:result candidate rules', () => {
    indexer.registerRule(ruleExact);
    const candidates = indexer.getCandidateRules('algebra', 'WIN');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('rule_exact');
  });

  it('matches wildcard category rules (category undefined)', () => {
    indexer.registerRule(ruleCatWildcard);
    const candidatesAlgebra = indexer.getCandidateRules('algebra', 'WIN');
    const candidatesGeo = indexer.getCandidateRules('geography', 'WIN');

    expect(candidatesAlgebra.map((r) => r.id)).toContain('rule_cat_wildcard');
    expect(candidatesGeo.map((r) => r.id)).toContain('rule_cat_wildcard');
  });

  it('matches wildcard resultFilter rules (resultFilter undefined)', () => {
    indexer.registerRule(ruleResultWildcard);

    const candidatesWin = indexer.getCandidateRules('algebra', 'WIN');
    const candidatesLoss = indexer.getCandidateRules('algebra', 'LOSS');

    expect(candidatesWin.map((r) => r.id)).toContain('rule_res_wildcard');
    expect(candidatesLoss.map((r) => r.id)).toContain('rule_res_wildcard');
  });

  it('matches double wildcard rules for any category and result', () => {
    indexer.registerRule(ruleDoubleWildcard);

    const candidates1 = indexer.getCandidateRules('history', 'LOSS');
    const candidates2 = indexer.getCandidateRules('science', 'DRAW');

    expect(candidates1.map((r) => r.id)).toContain('rule_double_wildcard');
    expect(candidates2.map((r) => r.id)).toContain('rule_double_wildcard');
  });

  it('aggregates exact and wildcard candidates into deduplicated result list', () => {
    indexer.registerRule(ruleExact);
    indexer.registerRule(ruleResultWildcard);
    indexer.registerRule(ruleCatWildcard);
    indexer.registerRule(ruleDoubleWildcard);

    const candidates = indexer.getCandidateRules('algebra', 'WIN');
    expect(candidates).toHaveLength(4);

    const ids = candidates.map((r) => r.id);
    expect(ids).toContain('rule_exact');
    expect(ids).toContain('rule_res_wildcard');
    expect(ids).toContain('rule_cat_wildcard');
    expect(ids).toContain('rule_double_wildcard');
  });

  it('supports dynamic rule addition at runtime', () => {
    expect(indexer.getCandidateRules('chemistry', 'WIN')).toHaveLength(0);

    const newRule: Rule = {
      id: 'rule_chem_win',
      name: 'Chem Win',
      description: 'Win chem match',
      type: 'STREAK',
      targetCount: 1,
      category: 'chemistry',
      resultFilter: 'WIN',
      reward: { type: 'COINS', amount: 20 },
      enabled: true,
      createdAt: Date.now(),
    };
    indexer.registerRule(newRule);

    const candidates = indexer.getCandidateRules('chemistry', 'WIN');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('rule_chem_win');
  });

  it('filters out disabled rules', () => {
    const disabledRule: Rule = {
      ...ruleExact,
      id: 'rule_disabled',
      enabled: false,
    };
    indexer.registerRule(disabledRule);

    const candidates = indexer.getCandidateRules('algebra', 'WIN');
    expect(candidates.find((r) => r.id === 'rule_disabled')).toBeUndefined();
  });

  it('supports rule unregistration', () => {
    indexer.registerRule(ruleExact);
    expect(indexer.getRule('rule_exact')).toBeDefined();

    const success = indexer.unregisterRule('rule_exact');
    expect(success).toBe(true);
    expect(indexer.getRule('rule_exact')).toBeUndefined();
    expect(indexer.getCandidateRules('algebra', 'WIN')).toHaveLength(0);
  });
});
