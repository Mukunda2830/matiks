import test from 'node:test';
import assert from 'node:assert';
import { EventBus } from '../harness/TestEngineHarness.ts';
import type { MatchCompletedEvent, RewardTriggeredEvent, LedgerEntry, PlayerState } from '../harness/TestEngineHarness.ts';
import { createMockMatchEvent } from '../harness/mockData.ts';

test('F2: Domain Models & EventBus - MatchCompleted Event Delivery', async () => {
  const bus = new EventBus();
  let received: MatchCompletedEvent | null = null;

  bus.on('MatchCompleted', (evt) => {
    received = evt;
  });

  const mockMatch = createMockMatchEvent({ playerId: 'player_f2_1' });
  bus.emit('MatchCompleted', mockMatch);

  assert.notStrictEqual(received, null);
  assert.strictEqual(received!.playerId, 'player_f2_1');
  assert.strictEqual(received!.result, 'WIN');
});

test('F2: Domain Models & EventBus - RewardTriggered Event Delivery', async () => {
  const bus = new EventBus();
  let triggered: RewardTriggeredEvent | null = null;

  bus.on('RewardTriggered', (evt) => {
    triggered = evt;
  });

  const sampleTriggered: RewardTriggeredEvent = {
    eventId: 'trig_1001',
    ruleId: 'rule_streak_3_wins',
    ruleName: '3 Win Streak',
    playerId: 'p123',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'dedup:p123:rule_streak_3_wins:100',
    triggeredAt: Date.now(),
    matchEventId: 'match_99',
  };

  bus.emit('RewardTriggered', sampleTriggered);

  assert.notStrictEqual(triggered, null);
  assert.strictEqual(triggered!.ruleId, 'rule_streak_3_wins');
  assert.strictEqual(triggered!.reward.amount, 50);
});

test('F2: Domain Models & EventBus - RewardGranted Payload Structure', async () => {
  const bus = new EventBus();
  let grantedPayload: { ledgerEntry: LedgerEntry; playerState: PlayerState } | null = null;

  bus.on('RewardGranted', (payload) => {
    grantedPayload = payload;
  });

  const ledger: LedgerEntry = {
    id: 'ledg_1',
    playerId: 'p1',
    ruleId: 'r1',
    ruleName: 'Streak 3',
    reward: { type: 'COINS', amount: 50 },
    idempotencyKey: 'dedup:p1:r1:1',
    grantedAt: Date.now(),
    status: 'GRANTED',
  };

  const state: PlayerState = {
    playerId: 'p1',
    currentStreak: 3,
    dailyMatchCount: 5,
    dailyWinCount: 3,
    windowedMatches: [],
    activeMultipliers: [],
    inventory: { coins: 50, lootBoxes: 0 },
    lastUpdated: Date.now(),
  };

  bus.emit('RewardGranted', { ledgerEntry: ledger, playerState: state });

  assert.notStrictEqual(grantedPayload, null);
  assert.strictEqual(grantedPayload!.ledgerEntry.status, 'GRANTED');
  assert.strictEqual(grantedPayload!.playerState.inventory.coins, 50);
});

test('F2: Domain Models & EventBus - RewardDeduped Payload Structure', async () => {
  const bus = new EventBus();
  let dedupPayload: { playerId: string; ruleId: string; idempotencyKey: string; timestamp: number } | null = null;

  bus.on('RewardDeduped', (payload) => {
    dedupPayload = payload;
  });

  bus.emit('RewardDeduped', {
    playerId: 'p1',
    ruleId: 'r1',
    idempotencyKey: 'dedup:p1:r1:1',
    timestamp: Date.now(),
  });

  assert.notStrictEqual(dedupPayload, null);
  assert.strictEqual(dedupPayload!.playerId, 'p1');
  assert.strictEqual(dedupPayload!.ruleId, 'r1');
});

test('F2: Domain Models & EventBus - Listener Removal and Isolation', () => {
  const bus = new EventBus();
  let count = 0;
  const listener = () => { count++; };

  bus.on('MatchCompleted', listener);
  bus.emit('MatchCompleted', createMockMatchEvent());
  assert.strictEqual(count, 1);

  bus.off('MatchCompleted', listener);
  bus.emit('MatchCompleted', createMockMatchEvent());
  assert.strictEqual(count, 1);
});

test('F2: Domain Models & EventBus - Multiple Listeners on Same Event Channel', () => {
  const bus = new EventBus();
  let l1Calls = 0;
  let l2Calls = 0;

  bus.on('MatchCompleted', () => { l1Calls++; });
  bus.on('MatchCompleted', () => { l2Calls++; });

  bus.emit('MatchCompleted', createMockMatchEvent());

  assert.strictEqual(l1Calls, 1);
  assert.strictEqual(l2Calls, 1);
});
