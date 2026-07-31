import test from 'node:test';
import assert from 'node:assert';
import { KeyValueStore } from '../harness/TestEngineHarness.ts';

test('F1: KeyValueStore - Basic String Set, Get, Exists, and Del', () => {
  const store = new KeyValueStore();
  assert.strictEqual(store.exists('key1'), false);
  assert.strictEqual(store.get('key1'), null);

  assert.strictEqual(store.set('key1', 'hello'), true);
  assert.strictEqual(store.exists('key1'), true);
  assert.strictEqual(store.get('key1'), 'hello');

  assert.strictEqual(store.del('key1'), true);
  assert.strictEqual(store.exists('key1'), false);
  assert.strictEqual(store.get('key1'), null);
});

test('F1: KeyValueStore - TTL Passive Expiration on Read', async () => {
  const store = new KeyValueStore();
  // Set with 1 second TTL
  store.set('ttl_key', 'expiring_value', 1);
  assert.strictEqual(store.get('ttl_key'), 'expiring_value');
  assert.strictEqual(store.ttl('ttl_key') > 0, true);

  // Wait 1.1s for expiration
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // Passive check should delete expired key and return null
  assert.strictEqual(store.get('ttl_key'), null);
  assert.strictEqual(store.exists('ttl_key'), false);
  assert.strictEqual(store.ttl('ttl_key'), -2);
});

test('F1: KeyValueStore - Atomic Increments with incrBy', () => {
  const store = new KeyValueStore();
  // Initial increment on non-existent key starts at 0 + 1 = 1
  assert.strictEqual(store.incrBy('counter', 1), 1);
  assert.strictEqual(store.get('counter'), '1');

  // Increment by 5
  assert.strictEqual(store.incrBy('counter', 5), 6);
  assert.strictEqual(store.get('counter'), '6');

  // Decrement by 2 (negative increment)
  assert.strictEqual(store.incrBy('counter', -2), 4);
  assert.strictEqual(store.get('counter'), '4');
});

test('F1: KeyValueStore - Set Operations (sAdd, sMembers, sIsMember, sRem, sCard)', () => {
  const store = new KeyValueStore();
  const setKey = 'user_tags';

  assert.strictEqual(store.sCard(setKey), 0);
  assert.deepStrictEqual(store.sMembers(setKey), []);

  // sAdd new members
  assert.strictEqual(store.sAdd(setKey), false); // empty add
  assert.strictEqual(store.sAdd(setKey, 'vip'), true);
  assert.strictEqual(store.sAdd(setKey, 'beta_tester'), true);
  assert.strictEqual(store.sAdd(setKey, 'vip'), false); // duplicate member

  assert.strictEqual(store.sCard(setKey), 2);
  assert.strictEqual(store.sIsMember(setKey, 'vip'), true);
  assert.strictEqual(store.sIsMember(setKey, 'guest'), false);

  const members = store.sMembers(setKey);
  assert.strictEqual(members.includes('vip'), true);
  assert.strictEqual(members.includes('beta_tester'), true);

  // sRem member
  assert.strictEqual(store.sRem(setKey, 'vip'), true);
  assert.strictEqual(store.sIsMember(setKey, 'vip'), false);
  assert.strictEqual(store.sCard(setKey), 1);

  // Remove last member deletes the set entry automatically
  assert.strictEqual(store.sRem(setKey, 'beta_tester'), true);
  assert.strictEqual(store.exists(setKey), false);
  assert.strictEqual(store.sCard(setKey), 0);
});

test('F1: KeyValueStore - Type Overwrite Safety', () => {
  const store = new KeyValueStore();
  // Set string key
  store.set('mixed_key', 'string_val');

  // Calling sAdd on string key should replace it with a new Set
  assert.strictEqual(store.sAdd('mixed_key', 'set_member_1'), true);
  assert.strictEqual(store.sIsMember('mixed_key', 'set_member_1'), true);
  assert.strictEqual(store.get('mixed_key'), null); // String get returns null for set type
});

test('F1: KeyValueStore - flushAll Clears All Memory and Timers', () => {
  const store = new KeyValueStore();
  store.set('k1', 'v1', 60);
  store.set('k2', 'v2');
  store.sAdd('k3', 'm1');

  assert.strictEqual(store.exists('k1'), true);
  assert.strictEqual(store.exists('k2'), true);

  store.flushAll();

  assert.strictEqual(store.exists('k1'), false);
  assert.strictEqual(store.exists('k2'), false);
  assert.strictEqual(store.exists('k3'), false);
});
