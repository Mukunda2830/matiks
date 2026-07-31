import test from 'node:test';
import assert from 'node:assert';
import { KeyValueStore, EventBus, RewardDispatcher } from '../harness/TestEngineHarness.ts';
import type { RewardTriggeredEvent } from '../harness/TestEngineHarness.ts';

test('F6: Idempotency Key Deduplication - Initial Reward Granted', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const trigger: RewardTriggeredEvent = {
    eventId: 'trig_001',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: 'player_dedup_1',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'dedup:player_dedup_1:rule_streak_3_wins:100',
    triggeredAt: Date.now(),
    matchEventId: 'match_001',
  };

  const ledgerResult = await dispatcher.dispatchReward(trigger);

  assert.strictEqual(ledgerResult.status, 'GRANTED');
  assert.strictEqual(ledgerResult.playerId, 'player_dedup_1');
  assert.strictEqual(store.exists('dedup:player_dedup_1:rule_streak_3_wins:100'), true);
});

test('F6: Idempotency Key Deduplication - Duplicate Trigger Suppressed and Marked DEDUPED', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const trigger: RewardTriggeredEvent = {
    eventId: 'trig_001',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: 'player_dedup_2',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'dedup:player_dedup_2:rule_streak_3_wins:100',
    triggeredAt: Date.now(),
    matchEventId: 'match_001',
  };

  const res1 = await dispatcher.dispatchReward(trigger);
  assert.strictEqual(res1.status, 'GRANTED');

  const res2 = await dispatcher.dispatchReward(trigger);
  assert.strictEqual(res2.status, 'DEDUPED');

  const playerState = dispatcher.getOrCreatePlayerState('player_dedup_2');
  assert.strictEqual(playerState.inventory.coins, 50);
});

test('F6: Idempotency Key Deduplication - Distinct Time Buckets Allow New Triggers', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const triggerBucket1: RewardTriggeredEvent = {
    eventId: 'trig_b1',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: 'player_dedup_3',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'dedup:player_dedup_3:rule_streak_3_wins:hour_10',
    triggeredAt: Date.now(),
    matchEventId: 'match_b1',
  };

  const triggerBucket2: RewardTriggeredEvent = {
    eventId: 'trig_b2',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: 'player_dedup_3',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'dedup:player_dedup_3:rule_streak_3_wins:hour_11',
    triggeredAt: Date.now() + 3600000,
    matchEventId: 'match_b2',
  };

  const res1 = await dispatcher.dispatchReward(triggerBucket1);
  const res2 = await dispatcher.dispatchReward(triggerBucket2);

  assert.strictEqual(res1.status, 'GRANTED');
  assert.strictEqual(res2.status, 'GRANTED');

  const playerState = dispatcher.getOrCreatePlayerState('player_dedup_3');
  assert.strictEqual(playerState.inventory.coins, 100);
});

test('F6: Idempotency Key Deduplication - Emits RewardDeduped Event on Collision', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  let dedupEventFired = false;
  bus.on('RewardDeduped', (evt) => {
    if (evt.playerId === 'player_dedup_evt') {
      dedupEventFired = true;
    }
  });

  const trigger: RewardTriggeredEvent = {
    eventId: 'trig_evt',
    ruleId: 'r_daily',
    ruleName: 'Daily Rule',
    playerId: 'player_dedup_evt',
    reward: { type: 'LOOT_BOX', amount: 1 },
    idempotencyKey: 'dedup:player_dedup_evt:r_daily:2026-07-31',
    triggeredAt: Date.now(),
    matchEventId: 'match_evt',
  };

  await dispatcher.dispatchReward(trigger);
  assert.strictEqual(dedupEventFired, false);

  await dispatcher.dispatchReward(trigger);
  assert.strictEqual(dedupEventFired, true);
});

test('F6: Idempotency Key Deduplication - Ledger History Audit Trail', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const trigger: RewardTriggeredEvent = {
    eventId: 'trig_audit',
    ruleId: 'r_coins',
    ruleName: 'Coins Rule',
    playerId: 'p_audit',
    reward: { type: 'COINS', amount: 10 },
    idempotencyKey: 'dedup:p_audit:r_coins:1',
    triggeredAt: Date.now(),
    matchEventId: 'm_audit',
  };

  await dispatcher.dispatchReward(trigger);
  await dispatcher.dispatchReward(trigger);

  const ledger = dispatcher.getLedger();
  assert.strictEqual(ledger.length, 2);
  assert.strictEqual(ledger[0].status, 'GRANTED');
  assert.strictEqual(ledger[1].status, 'DEDUPED');
});

test('F6: Idempotency Key Lock Has 1-Hour TTL in Store', async () => {
  const store = new KeyValueStore();
  const bus = new EventBus();
  const dispatcher = new RewardDispatcher(store, bus);

  const key = 'dedup:p_ttl:r_ttl:1';
  const trigger: RewardTriggeredEvent = {
    eventId: 'trig_ttl',
    ruleId: 'r_ttl',
    ruleName: 'TTL Rule',
    playerId: 'p_ttl',
    reward: { type: 'COINS', amount: 10 },
    idempotencyKey: key,
    triggeredAt: Date.now(),
    matchEventId: 'm_ttl',
  };

  await dispatcher.dispatchReward(trigger);
  const lockTtl = store.ttl(key);
  assert.strictEqual(lockTtl > 3500 && lockTtl <= 3600, true);
});
