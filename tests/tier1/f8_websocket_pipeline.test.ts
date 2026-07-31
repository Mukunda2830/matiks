import test from 'node:test';
import assert from 'node:assert';
import { PipelineSocketEmulator, KeyValueStore, EventBus, RewardDispatcher, RuleEngine } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent } from '../harness/mockData.ts';

test('F8: Socket.IO Pipeline - Stage 1 MATCH_RECEIVED Emission', () => {
  const socketEmulator = new PipelineSocketEmulator();
  let stage1Payload: any = null;

  socketEmulator.on('MATCH_RECEIVED', (payload) => {
    stage1Payload = payload;
  });

  const match = createMockMatchEvent({ playerId: 'p_ws_1' });
  socketEmulator.emitStageEvent('MATCH_RECEIVED', match);

  assert.notStrictEqual(stage1Payload, null);
  assert.strictEqual(stage1Payload.playerId, 'p_ws_1');
});

test('F8: Socket.IO Pipeline - Stage 2 RULE_CANDIDATES_FOUND Emission', () => {
  const socketEmulator = new PipelineSocketEmulator();
  let stage2Payload: any = null;

  socketEmulator.on('RULE_CANDIDATES_FOUND', (payload) => {
    stage2Payload = payload;
  });

  socketEmulator.emitStageEvent('RULE_CANDIDATES_FOUND', { candidateRuleIds: ['r1', 'r2'] });

  assert.notStrictEqual(stage2Payload, null);
  assert.deepStrictEqual(stage2Payload.candidateRuleIds, ['r1', 'r2']);
});

test('F8: Socket.IO Pipeline - Stage 3 COUNTERS_UPDATED Emission', () => {
  const socketEmulator = new PipelineSocketEmulator();
  let stage3Payload: any = null;

  socketEmulator.on('COUNTERS_UPDATED', (payload) => {
    stage3Payload = payload;
  });

  socketEmulator.emitStageEvent('COUNTERS_UPDATED', { playerId: 'p_ws_1', streak: 2, daily: 3 });

  assert.notStrictEqual(stage3Payload, null);
  assert.strictEqual(stage3Payload.streak, 2);
});

test('F8: Socket.IO Pipeline - Stage 4 THRESHOLD_MET Emission', () => {
  const socketEmulator = new PipelineSocketEmulator();
  let stage4Payload: any = null;

  socketEmulator.on('THRESHOLD_MET', (payload) => {
    stage4Payload = payload;
  });

  socketEmulator.emitStageEvent('THRESHOLD_MET', { ruleId: 'rule_streak_3_wins', playerId: 'p_ws_1' });

  assert.notStrictEqual(stage4Payload, null);
  assert.strictEqual(stage4Payload.ruleId, 'rule_streak_3_wins');
});

test('F8: Socket.IO Pipeline - Stage 5 REWARD_GRANTED Emission', () => {
  const socketEmulator = new PipelineSocketEmulator();
  let stage5Payload: any = null;

  socketEmulator.on('REWARD_GRANTED', (payload) => {
    stage5Payload = payload;
  });

  socketEmulator.emitStageEvent('REWARD_GRANTED', { ledgerId: 'ledg_99', status: 'GRANTED' });

  assert.notStrictEqual(stage5Payload, null);
  assert.strictEqual(stage5Payload.status, 'GRANTED');
});

test('F8: Socket.IO Pipeline - Stage 6 REWARD_DEDUPED Emission', () => {
  const socketEmulator = new PipelineSocketEmulator();
  let stage6Payload: any = null;

  socketEmulator.on('REWARD_DEDUPED', (payload) => {
    stage6Payload = payload;
  });

  socketEmulator.emitStageEvent('REWARD_DEDUPED', { ruleId: 'r1', idempotencyKey: 'dedup:p:r:1' });

  assert.notStrictEqual(stage6Payload, null);
  assert.strictEqual(stage6Payload.idempotencyKey, 'dedup:p:r:1');
});
