import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyValueStore } from '../src/store/KeyValueStore';

describe('KeyValueStore', () => {
  let store: KeyValueStore;

  beforeEach(() => {
    store = new KeyValueStore();
  });

  afterEach(async () => {
    await store.flushAll();
  });

  describe('Basic Key-Value Operations', () => {
    it('should set and get string values', async () => {
      await store.set('key1', 'value1');
      const val = await store.get('key1');
      expect(val).toBe('value1');
    });

    it('should return null for non-existent keys', async () => {
      const val = await store.get('unknown');
      expect(val).toBeNull();
    });

    it('should check existence of keys', async () => {
      expect(await store.exists('key1')).toBe(false);
      await store.set('key1', 'val1');
      expect(await store.exists('key1')).toBe(true);
    });

    it('should delete keys', async () => {
      await store.set('key1', 'val1');
      const deleted = await store.del('key1');
      expect(deleted).toBe(true);
      expect(await store.get('key1')).toBeNull();
      expect(await store.exists('key1')).toBe(false);
    });

    it('should overwrite existing key values', async () => {
      await store.set('key1', 'first');
      await store.set('key1', 'second');
      expect(await store.get('key1')).toBe('second');
    });
  });

  describe('TTL Expiration (Passive and Active)', () => {
    it('should return correct TTL values', async () => {
      expect(await store.ttl('nonexistent')).toBe(-2);
      await store.set('no_ttl', 'val');
      expect(await store.ttl('no_ttl')).toBe(-1);
      await store.set('with_ttl', 'val', 10);
      const ttl = await store.ttl('with_ttl');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('should expire keys passively on-read', async () => {
      // Set key with 1 second TTL
      await store.set('temp_passive', 'data', 1);

      // Verify key exists immediately
      expect(await store.get('temp_passive')).toBe('data');

      // Wait 1.1 seconds for TTL to elapse
      await new Promise((res) => setTimeout(res, 1100));

      // Key should be passively cleared on read
      const val = await store.get('temp_passive');
      expect(val).toBeNull();
      expect(await store.exists('temp_passive')).toBe(false);
    });

    it('should expire keys actively via background timer', async () => {
      // Set key with 50ms TTL
      await store.set('temp_active', 'active_data', 0.05);

      // Wait 100ms for active timer to trigger
      await new Promise((res) => setTimeout(res, 100));

      // Key should be gone
      expect(await store.exists('temp_active')).toBe(false);
    });

    it('should clear old active timers when overwriting key or TTL', async () => {
      await store.set('temp_overwrite', 'v1', 1);
      // Overwrite without TTL
      await store.set('temp_overwrite', 'v2');
      expect(await store.ttl('temp_overwrite')).toBe(-1);

      await new Promise((res) => setTimeout(res, 1100));
      expect(await store.get('temp_overwrite')).toBe('v2');
    });
  });

  describe('Atomic Increments (incrBy)', () => {
    it('should initialize non-existent key to amount', async () => {
      const val = await store.incrBy('counter', 5);
      expect(val).toBe(5);
      expect(await store.get('counter')).toBe('5');
    });

    it('should increment existing counter values', async () => {
      await store.set('counter', '10');
      const val1 = await store.incrBy('counter', 3);
      expect(val1).toBe(13);

      const val2 = await store.incrBy('counter', -5);
      expect(val2).toBe(8);
      expect(await store.get('counter')).toBe('8');
    });

    it('should support TTL parameter in incrBy', async () => {
      const val = await store.incrBy('ttl_counter', 1, 10);
      expect(val).toBe(1);
      const remainingTtl = await store.ttl('ttl_counter');
      expect(remainingTtl).toBeGreaterThan(0);
      expect(remainingTtl).toBeLessThanOrEqual(10);
    });

    it('should reset non-integer values when calling incrBy', async () => {
      await store.set('str_key', 'not_a_number');
      const val = await store.incrBy('str_key', 1);
      expect(val).toBe(1);
      expect(await store.get('str_key')).toBe('1');
    });
  });

  describe('Set Operations', () => {
    it('should add members to set with sAdd', async () => {
      const added1 = await store.sAdd('set1', 'm1');
      expect(added1).toBe(1);

      const added2 = await store.sAdd('set1', ['m1', 'm2', 'm3']);
      expect(added2).toBe(2); // 'm1' is duplicate

      expect(await store.sCard('set1')).toBe(3);
    });

    it('should return all set members with sMembers', async () => {
      await store.sAdd('set1', ['a', 'b', 'c']);
      const members = await store.sMembers('set1');
      expect(members.sort()).toEqual(['a', 'b', 'c']);
    });

    it('should return empty array for non-existent set key', async () => {
      const members = await store.sMembers('empty_set');
      expect(members).toEqual([]);
    });

    it('should verify member existence with sIsMember', async () => {
      await store.sAdd('users', 'alice');
      expect(await store.sIsMember('users', 'alice')).toBe(true);
      expect(await store.sIsMember('users', 'bob')).toBe(false);
      expect(await store.sIsMember('unknown_set', 'alice')).toBe(false);
    });

    it('should remove members with sRem and delete key when empty', async () => {
      await store.sAdd('items', ['i1', 'i2', 'i3']);

      const remCount = await store.sRem('items', ['i1', 'nonexistent']);
      expect(remCount).toBe(1);
      expect(await store.sCard('items')).toBe(2);

      await store.sRem('items', ['i2', 'i3']);
      expect(await store.sCard('items')).toBe(0);
      expect(await store.exists('items')).toBe(false);
    });

    it('should support TTL on set creation/update', async () => {
      await store.sAdd('timed_set', 'elem1', 10);
      const remainingTtl = await store.ttl('timed_set');
      expect(remainingTtl).toBeGreaterThan(0);
      expect(remainingTtl).toBeLessThanOrEqual(10);
    });
  });

  describe('flushAll Teardown', () => {
    it('should clear all keys and active timers', async () => {
      await store.set('k1', 'v1', 10);
      await store.sAdd('s1', 'm1', 10);
      await store.flushAll();

      expect(await store.exists('k1')).toBe(false);
      expect(await store.exists('s1')).toBe(false);
      expect(await store.get('k1')).toBeNull();
    });
  });
});
