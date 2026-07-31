import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyValueStore } from '../src/store/KeyValueStore';
import { EventBus } from '../src/domain/EventBus';
import { MatchCompletedEvent, RewardTriggeredEvent } from '../src/domain/models';

describe('Adversarial & Stress Tests — KeyValueStore & EventBus', () => {
  let store: KeyValueStore;
  let eventBus: EventBus;

  beforeEach(() => {
    store = new KeyValueStore();
    eventBus = new EventBus();
  });

  afterEach(async () => {
    await store.flushAll();
    eventBus.removeAllListeners();
  });

  // =========================================================================
  // 1. High-frequency concurrent atomic increments and TTL expiration races
  // =========================================================================
  describe('1. Concurrent Increments & TTL Expiration Races', () => {
    it('1.1 should correctly handle 5,000 concurrent atomic increments on a single key', async () => {
      const key = 'concurrent_counter';
      const concurrency = 5000;
      const tasks: Promise<number>[] = [];

      for (let i = 0; i < concurrency; i++) {
        tasks.push(store.incrBy(key, 1));
      }

      const results = await Promise.all(tasks);
      expect(results.length).toBe(concurrency);

      const finalVal = await store.get(key);
      expect(finalVal).toBe('5000');
    });

    it('1.2 should maintain mathematical sum consistency across 100 keys with 5,000 total increments', async () => {
      const numKeys = 100;
      const incrementsPerWorker = 50;
      const workers = 100; // 100 * 50 = 5000 increments
      const keys = Array.from({ length: numKeys }, (_, i) => `multi_key_${i}`);

      const tasks: Promise<number>[] = [];
      for (let w = 0; w < workers; w++) {
        for (let i = 0; i < incrementsPerWorker; i++) {
          const targetKey = keys[(w * incrementsPerWorker + i) % numKeys];
          tasks.push(store.incrBy(targetKey, 1));
        }
      }

      await Promise.all(tasks);

      let totalSum = 0;
      for (const k of keys) {
        const valStr = await store.get(k);
        totalSum += valStr ? parseInt(valStr, 10) : 0;
      }

      expect(totalSum).toBe(5000);
    });

    it('1.3 should handle race conditions between TTL expiration and active incrBy operations', async () => {
      const key = 'race_ttl_counter';
      // Set initial value with short TTL (60ms)
      await store.set(key, '100', 0.06);

      // Perform continuous increments over 120ms spanning across the TTL expiration point
      const startTime = Date.now();
      let incrementCount = 0;

      while (Date.now() - startTime < 120) {
        await store.incrBy(key, 1);
        incrementCount++;
        await new Promise((r) => setTimeout(r, 5));
      }

      // The key should either exist as a number > 0 or have reset when expired
      const valStr = await store.get(key);
      expect(valStr).not.toBeNull();
      const valNum = parseInt(valStr!, 10);
      expect(isNaN(valNum)).toBe(false);
      expect(valNum).toBeGreaterThan(0);
    });

    it('1.4 should correctly clear old timers under high-frequency TTL overwrites on incrBy', async () => {
      const key = 'ttl_overwrite_key';
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        // Repeatedly overwrite TTL with 10s
        await store.incrBy(key, 1, 10);
      }

      const finalVal = await store.get(key);
      expect(finalVal).toBe(iterations.toString());

      const ttl = await store.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('1.5 should handle negative and zero TTL passed to incrBy', async () => {
      const key = 'zero_ttl_key';
      await store.set(key, '10');

      const val = await store.incrBy(key, 5, 0); // 0 TTL means immediate deletion
      expect(val).toBe(15); // returns new incremented value
      expect(await store.get(key)).toBeNull(); // but key was deleted by setTTL(key, 0)
      expect(await store.exists(key)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Large set operations (sAdd, sMembers, sRem, sCard) and TTL cleanup
  // =========================================================================
  describe('2. Large Set Operations & TTL Cleanup', () => {
    it('2.1 should handle 50,000 set additions efficiently and return correct card/members', async () => {
      const key = 'large_set_1';
      const count = 50000;
      const batchSize = 5000;

      for (let i = 0; i < count; i += batchSize) {
        const batch = Array.from({ length: batchSize }, (_, idx) => `user_${i + idx}`);
        await store.sAdd(key, batch);
      }

      const card = await store.sCard(key);
      expect(card).toBe(count);

      const members = await store.sMembers(key);
      expect(members.length).toBe(count);
    });

    it('2.2 should handle concurrent sAdd and sRem operations on the same set', async () => {
      const key = 'concurrent_set';
      const elements = 2000;

      // First add 1000 items
      const initialBatch = Array.from({ length: 1000 }, (_, i) => `item_${i}`);
      await store.sAdd(key, initialBatch);

      // Concurrent adds (1000..1999) and rems (0..499)
      const addTasks = Array.from({ length: 1000 }, (_, i) =>
        store.sAdd(key, `item_${1000 + i}`)
      );
      const remTasks = Array.from({ length: 500 }, (_, i) =>
        store.sRem(key, `item_${i}`)
      );

      await Promise.all([...addTasks, ...remTasks]);

      const finalCard = await store.sCard(key);
      // Expected: 2000 total added - 500 removed = 1500 remaining
      expect(finalCard).toBe(1500);

      // Verify removed items are missing
      expect(await store.sIsMember(key, 'item_0')).toBe(false);
      expect(await store.sIsMember(key, 'item_499')).toBe(false);
      // Verify kept items are present
      expect(await store.sIsMember(key, 'item_500')).toBe(true);
      expect(await store.sIsMember(key, 'item_1999')).toBe(true);
    });

    it('2.3 should auto-delete key when all set members are removed via sRem', async () => {
      const key = 'auto_delete_set';
      const items = ['a', 'b', 'c', 'd', 'e'];
      await store.sAdd(key, items);

      expect(await store.exists(key)).toBe(true);

      const removed = await store.sRem(key, items);
      expect(removed).toBe(5);
      expect(await store.sCard(key)).toBe(0);
      expect(await store.exists(key)).toBe(false);
      expect(await store.sMembers(key)).toEqual([]);
    });

    it('2.4 should passively and actively expire large sets with TTL', async () => {
      const key = 'ttl_large_set';
      const items = Array.from({ length: 10000 }, (_, i) => `member_${i}`);

      // Set key with 60ms TTL
      await store.sAdd(key, items, 0.06);
      expect(await store.sCard(key)).toBe(10000);

      // Wait 100ms for TTL to expire
      await new Promise((r) => setTimeout(r, 100));

      // Should be expired passively and actively
      expect(await store.exists(key)).toBe(false);
      expect(await store.sCard(key)).toBe(0);
      expect(await store.sMembers(key)).toEqual([]);
    });
  });

  // =========================================================================
  // 3. EventBus high-concurrency event publishing and listener memory leak checks
  // =========================================================================
  describe('3. EventBus High-Concurrency & Memory Leak Checks', () => {
    it('3.1 should process 100,000 published events across multiple channels accurately', async () => {
      let matchCount = 0;
      let rewardTriggeredCount = 0;

      eventBus.on('MatchCompleted', () => {
        matchCount++;
      });
      eventBus.on('RewardTriggered', () => {
        rewardTriggeredCount++;
      });

      const totalEvents = 50000;
      const sampleMatchEvent: MatchCompletedEvent = {
        matchId: 'm1',
        playerId: 'p1',
        gameMode: 'algebra',
        result: 'WIN',
        score: 100,
        timestamp: Date.now(),
      };
      const sampleRewardEvent: RewardTriggeredEvent = {
        ruleId: 'r1',
        playerId: 'p1',
        rewardType: 'COINS',
        amount: 50,
        idempotencyKey: 'idempotent_1',
        timestamp: Date.now(),
      };

      for (let i = 0; i < totalEvents; i++) {
        eventBus.emit('MatchCompleted', sampleMatchEvent);
        eventBus.emit('RewardTriggered', sampleRewardEvent);
      }

      expect(matchCount).toBe(totalEvents);
      expect(rewardTriggeredCount).toBe(totalEvents);
    });

    it('3.2 should clean up listener counts and avoid memory leaks when subscribing and unsubscribing', async () => {
      const eventName = 'MatchCompleted';
      const iterations = 5000;

      const listeners: Array<(payload: MatchCompletedEvent) => void> = [];

      // Phase 1: Register 5,000 listeners
      for (let i = 0; i < iterations; i++) {
        const fn = () => {};
        listeners.push(fn);
        eventBus.on(eventName, fn);
      }

      expect(eventBus.listenerCount(eventName)).toBe(iterations);

      // Phase 2: Unsubscribe all listeners
      for (const fn of listeners) {
        eventBus.off(eventName, fn);
      }

      expect(eventBus.listenerCount(eventName)).toBe(0);
    });

    it('3.3 should automatically remove once listeners after invocation under heavy load', async () => {
      const iterations = 2000;
      let callCount = 0;

      for (let i = 0; i < iterations; i++) {
        eventBus.once('RewardTriggered', () => {
          callCount++;
        });
      }

      expect(eventBus.listenerCount('RewardTriggered')).toBe(iterations);

      // Emit event
      eventBus.emit('RewardTriggered', {
        ruleId: 'r1',
        playerId: 'p1',
        rewardType: 'COINS',
        amount: 10,
        idempotencyKey: 'key_1',
        timestamp: Date.now(),
      });

      expect(callCount).toBe(iterations);
      expect(eventBus.listenerCount('RewardTriggered')).toBe(0);
    });

    it('3.4 should support listener count beyond 100 without throwing errors', () => {
      const count = 150;
      for (let i = 0; i < count; i++) {
        eventBus.on('MatchCompleted', () => {});
      }
      expect(eventBus.listenerCount('MatchCompleted')).toBe(count);
    });

    it('3.5 should verify memory stability over 50,000 event iterations', () => {
      if (global.gc) {
        global.gc();
      }
      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 50000; i++) {
        const bus = new EventBus();
        bus.on('MatchCompleted', () => {});
        bus.emit('MatchCompleted', {
          matchId: `m_${i}`,
          playerId: 'p1',
          gameMode: 'algebra',
          result: 'WIN',
          score: 10,
          timestamp: Date.now(),
        });
        bus.removeAllListeners();
      }

      if (global.gc) {
        global.gc();
      }
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryDiffMB = (finalMemory - initialMemory) / (1024 * 1024);

      // Heap growth should be minimal (< 30 MB)
      expect(memoryDiffMB).toBeLessThan(30);
    });

    it('3.6 should correctly unregister `once` listeners when calling `off` prior to event emission', () => {
      let called = false;
      const listener = () => {
        called = true;
      };

      eventBus.once('MatchCompleted', listener);
      expect(eventBus.listenerCount('MatchCompleted')).toBe(1);

      eventBus.off('MatchCompleted', listener);
      expect(eventBus.listenerCount('MatchCompleted')).toBe(0);

      eventBus.emit('MatchCompleted', {
        matchId: 'm1',
        playerId: 'p1',
        gameMode: 'algebra',
        result: 'WIN',
        score: 10,
        timestamp: Date.now(),
      });

      expect(called).toBe(false);
    });
  });

  // =========================================================================
  // 4. Advanced Concurrency & Edge Case Stress Harness
  // =========================================================================
  describe('4. Rapid Type Switching & Concurrent flushAll', () => {
    it('4.1 should handle rapid concurrent type switching on the same key', async () => {
      const key = 'type_switch_key';

      for (let i = 0; i < 500; i++) {
        if (i % 2 === 0) {
          await store.set(key, `val_${i}`);
          expect(await store.get(key)).toBe(`val_${i}`);
        } else {
          await store.sAdd(key, [`member_${i}`]);
          expect(await store.sCard(key)).toBe(1);
        }
      }
    });

    it('4.2 should safely execute flushAll while 10,000 key timers are active', async () => {
      // Create 10,000 keys with active timers (100s TTL)
      const tasks: Promise<boolean>[] = [];
      for (let i = 0; i < 10000; i++) {
        tasks.push(store.set(`temp_key_${i}`, `val_${i}`, 100));
      }
      await Promise.all(tasks);

      // Flush all
      await store.flushAll();

      // Verify all keys are gone and store is empty
      expect(await store.exists('temp_key_0')).toBe(false);
      expect(await store.exists('temp_key_9999')).toBe(false);
      expect(await store.get('temp_key_5000')).toBeNull();
    });

    it('4.3 should handle simultaneous active expiration of 5,000 keys without dropping events or crashing', async () => {
      // Set 5,000 keys with 50ms TTL
      const tasks: Promise<boolean>[] = [];
      for (let i = 0; i < 5000; i++) {
        tasks.push(store.set(`expire_key_${i}`, `v_${i}`, 0.05));
      }
      await Promise.all(tasks);

      // Wait 100ms for active timer callbacks to fire concurrently
      await new Promise((r) => setTimeout(r, 100));

      // Verify keys are expired
      for (let i = 0; i < 100; i++) {
        expect(await store.exists(`expire_key_${i}`)).toBe(false);
      }
    });
  });
});

