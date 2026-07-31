import test from 'node:test';
import assert from 'node:assert';
import { RuleIndexer } from '../harness/TestEngineHarness.ts';
import type { Rule } from '../harness/TestEngineHarness.ts';
import { createMockRule } from '../harness/mockData.ts';

test('F5: Rule Indexer - Exact Category and Result Lookup (category:result)', () => {
  const indexer = new RuleIndexer();
  const rule: Rule = createMockRule({
    id: 'r_exact',
    category: 'algebra',
    resultFilter: 'WIN',
  });
  indexer.registerRule(rule);

  const candidates = indexer.getCandidateRules('algebra', 'WIN');
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'r_exact');
});

test('F5: Rule Indexer - Wildcard Category Lookup (*:result)', () => {
  const indexer = new RuleIndexer();
  const ruleWildCategory: Rule = createMockRule({
    id: 'r_wild_cat',
    category: undefined,
    resultFilter: 'WIN',
  });
  indexer.registerRule(ruleWildCategory);

  const candidatesGeom = indexer.getCandidateRules('geometry', 'WIN');
  assert.strictEqual(candidatesGeom.length, 1);
  assert.strictEqual(candidatesGeom[0].id, 'r_wild_cat');

  const candidatesAlg = indexer.getCandidateRules('algebra', 'WIN');
  assert.strictEqual(candidatesAlg.length, 1);
  assert.strictEqual(candidatesAlg[0].id, 'r_wild_cat');
});

test('F5: Rule Indexer - Wildcard Result Lookup (category:*)', () => {
  const indexer = new RuleIndexer();
  const ruleWildResult: Rule = createMockRule({
    id: 'r_wild_res',
    category: 'calculus',
    resultFilter: undefined,
  });
  indexer.registerRule(ruleWildResult);

  const candidatesWin = indexer.getCandidateRules('calculus', 'WIN');
  assert.strictEqual(candidatesWin.length, 1);

  const candidatesLoss = indexer.getCandidateRules('calculus', 'LOSS');
  assert.strictEqual(candidatesLoss.length, 1);
});

test('F5: Rule Indexer - Universal Wildcard Lookup (*:*)', () => {
  const indexer = new RuleIndexer();
  const ruleUniversal: Rule = createMockRule({
    id: 'r_univ',
    category: undefined,
    resultFilter: undefined,
  });
  indexer.registerRule(ruleUniversal);

  const candidates = indexer.getCandidateRules('any_cat', 'LOSS');
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'r_univ');
});

test('F5: Rule Indexer - Disabled Rules Excluded from Candidates', () => {
  const indexer = new RuleIndexer();
  const activeRule = createMockRule({ id: 'r_active', category: 'algebra', resultFilter: 'WIN', enabled: true });
  const disabledRule = createMockRule({ id: 'r_disabled', category: 'algebra', resultFilter: 'WIN', enabled: false });

  indexer.registerRule(activeRule);
  indexer.registerRule(disabledRule);

  const candidates = indexer.getCandidateRules('algebra', 'WIN');
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'r_active');
});

test('F5: Rule Indexer - Retrieve All Registered Rules', () => {
  const indexer = new RuleIndexer();
  const r1 = createMockRule({ id: 'rule_1' });
  const r2 = createMockRule({ id: 'rule_2' });

  indexer.registerRule(r1);
  indexer.registerRule(r2);

  const allRules = indexer.getAllRules();
  assert.strictEqual(allRules.length, 2);
  assert.strictEqual(indexer.getRule('rule_1')?.id, 'rule_1');
  assert.strictEqual(indexer.getRule('rule_non_existent'), undefined);
});
