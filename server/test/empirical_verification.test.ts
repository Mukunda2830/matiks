import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyValueStore } from '../src/store/KeyValueStore';
import { getSeedRules, SEED_RULES } from '../src/domain/seedRules';

describe('Empirical Verification Harness — Challenger M1-2', () => {
  let store: KeyValueStore;

  beforeEach(() => {
    store = new KeyValueStore();
    vi.useRealTimers();
  });

  afterEach(async () => {
    await store.flushAll();
    vi.useRealTimers();
  });

  // ==========================================
  // AREA 1: Millisecond Boundary & TTL Expiry
  // ==========================================
  describe('1. Exact Millisecond Boundaries (Passive vs Active TTL)', () => {
    it('should maintain key availability 1ms before TTL expiration and expire at exact millisecond boundary', async () => {
      vi.useFakeTimers();
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);

      // Set key with 1 second (1000ms) TTL
      await store.set('boundary_key', 'val_1000', 1);

      // Verify key exists at T+0ms
      expect(await store.get('boundary_key')).toBe('val_1000');
      expect(await store.exists('boundary_key')).toBe(true);

      // Advance by 999ms (T+999ms: 1ms before expiration)
      vi.setSystemTime(startTime + 999);
      expect(await store.get('boundary_key')).toBe('val_1000');
      expect(await store.exists('boundary_key')).toBe(true);
      expect(await store.ttl('boundary_key')).toBe(1);

      // Advance by 1ms (T+1000ms: EXACT millisecond boundary)
      vi.setSystemTime(startTime + 1000);

      // Passive check (Date.now() >= expiresAt -> 1700000001000 >= 1700000001000)
      expect(await store.get('boundary_key')).toBeNull();
      expect(await store.exists('boundary_key')).toBe(false);
      expect(await store.ttl('boundary_key')).toBe(-2);

      // Advance by 1ms past boundary (T+1001ms)
      vi.setSystemTime(startTime + 1001);
      expect(await store.get('boundary_key')).toBeNull();
    });

    it('should handle active TTL timer execution at exact boundary without race condition with passive read', async () => {
      vi.useFakeTimers();
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);

      await store.set('active_race_key', 'race_val', 1);

      // Advance time to exact boundary T+1000ms without firing timers yet
      vi.setSystemTime(startTime + 1000);

      // Passive read occurs FIRST before background timer callback runs
      const val = await store.get('active_race_key');
      expect(val).toBeNull(); // Passive expiry cleans up key and cancels active timer

      // Now run active timers — should execute cleanly without error or double deletion side-effect
      expect(() => vi.runAllTimers()).not.toThrow();
      expect(await store.exists('active_race_key')).toBe(false);
    });

    it('should immediately expire/delete keys when ttlSeconds <= 0', async () => {
      // TTL = 0
      await store.set('zero_ttl_key', 'value', 0);
      expect(await store.get('zero_ttl_key')).toBeNull();
      expect(await store.exists('zero_ttl_key')).toBe(false);

      // Negative TTL
      await store.set('neg_ttl_key', 'value', -5);
      expect(await store.get('neg_ttl_key')).toBeNull();

      // incrBy with TTL = 0
      const incrRes = await store.incrBy('incr_zero_ttl', 10, 0);
      expect(incrRes).toBe(10); // returns calculated value
      expect(await store.get('incr_zero_ttl')).toBeNull(); // but key is immediately removed

      // sAdd with TTL = 0
      const sAddRes = await store.sAdd('set_zero_ttl', ['m1', 'm2'], 0);
      expect(sAddRes).toBe(2);
      expect(await store.sMembers('set_zero_ttl')).toEqual([]);
    });

    it('should correctly clear active timers when key TTL is updated or removed', async () => {
      vi.useFakeTimers();
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);

      // Set key with 1s TTL
      await store.set('update_ttl_key', 'v1', 1);
      expect(await store.ttl('update_ttl_key')).toBe(1);

      // Overwrite key without TTL
      await store.set('update_ttl_key', 'v2');
      expect(await store.ttl('update_ttl_key')).toBe(-1);

      // Advance past the original 1s TTL (T+1500ms)
      vi.setSystemTime(startTime + 1500);
      vi.runAllTimers();

      // Key should still exist with 'v2' since timer was cleared
      expect(await store.get('update_ttl_key')).toBe('v2');
      expect(await store.exists('update_ttl_key')).toBe(true);
    });

    it('should handle ttl() response behavior precisely at expiration boundary', async () => {
      vi.useFakeTimers();
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);

      await store.set('ttl_precision', 'data', 2);
      expect(await store.ttl('ttl_precision')).toBe(2);

      vi.setSystemTime(startTime + 1001); // 999ms remaining -> ceil(0.999) = 1
      expect(await store.ttl('ttl_precision')).toBe(1);

      vi.setSystemTime(startTime + 2000); // exact boundary -> passive check triggers -> returns -2
      expect(await store.ttl('ttl_precision')).toBe(-2);
    });
  });

  // ==========================================
  // AREA 2: KeyValueStore Type Safety
  // ==========================================
  describe('2. KeyValueStore Type Safety Edge Cases', () => {
    it('should handle incrBy on non-numeric string values and edge case numeric strings', async () => {
      // Non-numeric string: 'abc'
      await store.set('str_abc', 'abc');
      const res1 = await store.incrBy('str_abc', 5);
      expect(res1).toBe(5);
      expect(await store.get('str_abc')).toBe('5');

      // Empty string: ''
      await store.set('str_empty', '');
      const res2 = await store.incrBy('str_empty', 3);
      expect(res2).toBe(3);
      expect(await store.get('str_empty')).toBe('3');

      // Floating point string: '12.34' -> parseInt parses '12'
      await store.set('str_float', '12.34');
      const res3 = await store.incrBy('str_float', 1);
      expect(res3).toBe(13);

      // Trailing text: '10abc' -> parseInt parses '10'
      await store.set('str_trailing', '10abc');
      const res4 = await store.incrBy('str_trailing', 5);
      expect(res4).toBe(15);

      // Infinity string: 'Infinity'
      await store.set('str_inf', 'Infinity');
      const res5 = await store.incrBy('str_inf', 10);
      expect(res5).toBe(10);

      // Large numeric string
      await store.set('str_large', '9007199254740991');
      const res6 = await store.incrBy('str_large', 1);
      expect(res6).toBe(9007199254740992);
    });

    it('should gracefully handle calling incrBy on a Set key by converting/overwriting entry type', async () => {
      // Create a set key
      await store.sAdd('set_as_counter', ['user1', 'user2']);
      expect(await store.sCard('set_as_counter')).toBe(2);

      // Execute incrBy on the set key
      const result = await store.incrBy('set_as_counter', 1);
      expect(result).toBe(1);

      // Key should now be a StringEntry, no longer a SetEntry
      expect(await store.get('set_as_counter')).toBe('1');
      expect(await store.sMembers('set_as_counter')).toEqual([]);
      expect(await store.sCard('set_as_counter')).toBe(0);
      expect(await store.sIsMember('set_as_counter', 'user1')).toBe(false);
    });

    it('should gracefully handle calling Set operations on a String key', async () => {
      await store.set('str_key', 'hello_world');

      // sMembers on string key -> returns empty array, does not crash or corrupt string
      expect(await store.sMembers('str_key')).toEqual([]);
      expect(await store.get('str_key')).toBe('hello_world');

      // sIsMember on string key -> returns false
      expect(await store.sIsMember('str_key', 'hello_world')).toBe(false);

      // sRem on string key -> returns 0
      expect(await store.sRem('str_key', 'hello_world')).toBe(0);

      // sCard on string key -> returns 0
      expect(await store.sCard('str_key')).toBe(0);

      // sAdd on string key -> overwrites string key with a Set key
      const added = await store.sAdd('str_key', 'new_member');
      expect(added).toBe(1);
      expect(await store.get('str_key')).toBeNull(); // get returns null for set key
      expect(await store.sMembers('str_key')).toEqual(['new_member']);
    });

    it('should maintain type segregation between String and Set operations', async () => {
      await store.sAdd('my_set', ['a', 'b']);

      // get() on set key returns null
      expect(await store.get('my_set')).toBeNull();

      // set() on existing set key converts entry to string
      await store.set('my_set', 'now_a_string');
      expect(await store.get('my_set')).toBe('now_a_string');
      expect(await store.sMembers('my_set')).toEqual([]);
    });
  });

  // ==========================================
  // AREA 3: Seed Rules Immutability & Clones
  // ==========================================
  describe('3. Seed Rules Immutability and Deep Clone Validation', () => {
    it('should produce independent deep clones from getSeedRules()', () => {
      const clone1 = getSeedRules();
      const clone2 = getSeedRules();

      // Verify identical content initially
      expect(clone1).toEqual(clone2);
      expect(clone1).not.toBe(clone2);

      // Mutate top-level properties on clone1
      clone1[0].id = 'MUTATED_ID';
      clone1[0].name = 'MUTATED_NAME';

      // Mutate nested reward object on clone1
      clone1[0].reward.amount = 999999;
      clone1[0].reward.type = 'MULTIPLIER';

      // Push new rule into clone1
      clone1.push({
        id: 'hacked_rule',
        name: 'Hacked Rule',
        description: 'Attack rule',
        type: 'STREAK',
        targetCount: 1,
        reward: { type: 'COINS', amount: 1000000 },
        enabled: true,
        createdAt: Date.now(),
      });

      // Verify clone2 remains completely uncorrupted
      expect(clone2.length).toBe(3);
      expect(clone2[0].id).toBe('rule_streak_3_wins');
      expect(clone2[0].name).toBe('3 Win Streak');
      expect(clone2[0].reward.amount).toBe(50);
      expect(clone2[0].reward.type).toBe('COINS');

      // Request fresh clone3 to confirm module state remains uncorrupted
      const clone3 = getSeedRules();
      expect(clone3).toEqual(clone2);
    });

    it('evaluates immutability protection of the underlying SEED_RULES export reference', () => {
      // NOTE: SEED_RULES is exported directly from seedRules.ts
      // Check if SEED_RULES is frozen with Object.freeze
      const isFrozen = Object.isFrozen(SEED_RULES);
      const isElementFrozen = Object.isFrozen(SEED_RULES[0]);
      const isRewardFrozen = Object.isFrozen(SEED_RULES[0].reward);

      // Document whether underlying SEED_RULES array is frozen
      // If NOT frozen, direct mutation of SEED_RULES export pollutes getSeedRules() output!
      if (!isFrozen) {
        // Demonstrate vulnerability if SEED_RULES export reference is directly mutated
        const originalAmount = SEED_RULES[0].reward.amount;
        try {
          SEED_RULES[0].reward.amount = 777777; // Direct mutation of exported reference
          const pollutedClone = getSeedRules();
          // If SEED_RULES[0] was mutable, getSeedRules() returns polluted clone!
          expect(pollutedClone[0].reward.amount).toBe(777777);
        } finally {
          // Restore original state to prevent test pollution
          SEED_RULES[0].reward.amount = originalAmount;
        }
      }

      // Record result assertion
      expect(typeof isFrozen).toBe('boolean');
    });
  });
});
