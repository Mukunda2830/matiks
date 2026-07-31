import Redis from 'ioredis';

export type ValueType = 'string' | 'set';

export interface BaseEntry {
  type: ValueType;
  expiresAt?: number; // Epoch timestamp in ms
  timerId?: NodeJS.Timeout;
}

export interface StringEntry extends BaseEntry {
  type: 'string';
  value: string;
}

export interface SetEntry extends BaseEntry {
  type: 'set';
  value: Set<string>;
}

export type StoreEntry = StringEntry | SetEntry;

export class KeyValueStore {
  private inMemoryStore = new Map<string, StoreEntry>();
  private redisClient: Redis | null = null;
  private isRedisConnected = false;
  private initPromise: Promise<boolean> | null = null;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    if (url) {
      this.initPromise = this.initRedis(url);
    }
  }

  public async initRedis(url?: string): Promise<boolean> {
    const targetUrl = url || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    if (!targetUrl) return false;

    if (this.isRedisConnected && this.redisClient) {
      return true;
    }

    try {
      if (this.redisClient) {
        try {
          await this.redisClient.quit();
        } catch {}
      }

      this.redisClient = new Redis(targetUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
        connectTimeout: 10000,
      });

      await this.redisClient.connect();
      this.isRedisConnected = true;
      const maskedUrl = targetUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
      console.log(`[KeyValueStore] Connected to real Redis Cloud instance at ${maskedUrl}`);
      return true;
    } catch (err: any) {
      this.isRedisConnected = false;
      const maskedUrl = targetUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
      console.warn(`[KeyValueStore] Could not connect to Redis at ${maskedUrl}: ${err?.message || err}. Using in-memory fallback.`);
      return false;
    }
  }

  private async ensureRedisConnected(): Promise<boolean> {
    if (this.isRedisConnected && this.redisClient) return true;
    if (this.initPromise) {
      await this.initPromise;
      if (this.isRedisConnected && this.redisClient) return true;
    }
    const url = process.env.REDIS_URL;
    if (url) {
      this.initPromise = this.initRedis(url);
      await this.initPromise;
    }
    return this.isRedisConnected && this.redisClient !== null;
  }

  public isUsingRealRedis(): boolean {
    return this.isRedisConnected;
  }

  public getMode(): 'real-redis' | 'in-memory-fallback' {
    return this.isRedisConnected ? 'real-redis' : 'in-memory-fallback';
  }

  // --- In-memory fallback helper logic ---

  private checkPassiveExpiry(key: string): boolean {
    const entry = this.inMemoryStore.get(key);
    if (!entry) return false;

    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.delInternal(key);
      return true;
    }
    return false;
  }

  private delInternal(key: string): boolean {
    const entry = this.inMemoryStore.get(key);
    if (!entry) return false;

    if (entry.timerId) {
      clearTimeout(entry.timerId);
    }
    this.inMemoryStore.delete(key);
    return true;
  }

  private setTTL(key: string, ttlSeconds?: number): void {
    const entry = this.inMemoryStore.get(key);
    if (!entry) return;

    if (entry.timerId) {
      clearTimeout(entry.timerId);
      entry.timerId = undefined;
    }

    if (ttlSeconds !== undefined) {
      if (ttlSeconds <= 0) {
        this.delInternal(key);
        return;
      }
      const expiresAt = Date.now() + ttlSeconds * 1000;
      const timerId = setTimeout(() => {
        this.delInternal(key);
      }, ttlSeconds * 1000);

      if (typeof timerId.unref === 'function') {
        timerId.unref();
      }

      entry.expiresAt = expiresAt;
      entry.timerId = timerId;
    } else {
      entry.expiresAt = undefined;
    }
  }

  // --- Core Key-Value Operations ---

  public async get(key: string): Promise<string | null> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.get(key);
      } catch (e) {
        console.error('[KeyValueStore] Redis GET error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const entry = this.inMemoryStore.get(key);
    if (!entry || entry.type !== 'string') {
      return null;
    }
    return entry.value;
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redisClient.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.redisClient.set(key, value);
        }
        return true;
      } catch (e) {
        console.error('[KeyValueStore] Redis SET error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const existing = this.inMemoryStore.get(key);
    if (existing?.timerId) {
      clearTimeout(existing.timerId);
    }

    const newEntry: StringEntry = {
      type: 'string',
      value,
    };
    this.inMemoryStore.set(key, newEntry);
    this.setTTL(key, ttlSeconds);
    return true;
  }

  public async setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        let result: string | null = null;
        if (ttlSeconds && ttlSeconds > 0) {
          result = await this.redisClient.set(key, value, 'EX', ttlSeconds, 'NX');
        } else {
          result = await this.redisClient.set(key, value, 'NX');
        }
        return result === 'OK';
      } catch (e) {
        console.error('[KeyValueStore] Redis SETNX error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const existing = this.inMemoryStore.get(key);
    if (existing) {
      return false;
    }

    const newEntry: StringEntry = {
      type: 'string',
      value,
    };
    this.inMemoryStore.set(key, newEntry);
    this.setTTL(key, ttlSeconds);
    return true;
  }

  public async del(key: string): Promise<boolean> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        const deleted = await this.redisClient.del(key);
        return deleted > 0;
      } catch (e) {
        console.error('[KeyValueStore] Redis DEL error:', e);
      }
    }

    return this.delInternal(key);
  }

  public async exists(key: string): Promise<boolean> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        const count = await this.redisClient.exists(key);
        return count > 0;
      } catch (e) {
        console.error('[KeyValueStore] Redis EXISTS error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    return this.inMemoryStore.has(key);
  }

  public async ttl(key: string): Promise<number> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.ttl(key);
      } catch (e) {
        console.error('[KeyValueStore] Redis TTL error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const entry = this.inMemoryStore.get(key);
    if (!entry) {
      return -2;
    }
    if (entry.expiresAt === undefined) {
      return -1;
    }
    const remainingMs = entry.expiresAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  public async incrBy(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        const newVal = await this.redisClient.incrby(key, amount);
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redisClient.expire(key, ttlSeconds);
        }
        return newVal;
      } catch (e) {
        console.error('[KeyValueStore] Redis INCRBY error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    let entry = this.inMemoryStore.get(key);
    let currentVal = 0;

    if (entry) {
      if (entry.type === 'string') {
        const parsed = parseInt(entry.value, 10);
        if (!isNaN(parsed)) {
          currentVal = parsed;
        }
      } else {
        this.delInternal(key);
        entry = undefined;
      }
    }

    const newVal = currentVal + amount;
    if (entry && entry.type === 'string') {
      entry.value = newVal.toString();
      if (ttlSeconds !== undefined) {
        this.setTTL(key, ttlSeconds);
      }
    } else {
      const newEntry: StringEntry = {
        type: 'string',
        value: newVal.toString(),
      };
      this.inMemoryStore.set(key, newEntry);
      if (ttlSeconds !== undefined) {
        this.setTTL(key, ttlSeconds);
      }
    }

    return newVal;
  }

  // --- Set Operations ---

  public async sAdd(
    key: string,
    members: string | string[],
    ttlSeconds?: number
  ): Promise<number> {
    const memberArray = Array.isArray(members) ? members : [members];

    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        const added = await this.redisClient.sadd(key, ...memberArray);
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redisClient.expire(key, ttlSeconds);
        }
        return added;
      } catch (e) {
        console.error('[KeyValueStore] Redis SADD error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    let entry = this.inMemoryStore.get(key);
    if (entry && entry.type !== 'set') {
      this.delInternal(key);
      entry = undefined;
    }

    if (!entry) {
      entry = {
        type: 'set',
        value: new Set<string>(),
      };
      this.inMemoryStore.set(key, entry);
    }

    const setEntry = entry as SetEntry;
    let addedCount = 0;
    for (const m of memberArray) {
      if (!setEntry.value.has(m)) {
        setEntry.value.add(m);
        addedCount++;
      }
    }

    if (ttlSeconds !== undefined) {
      this.setTTL(key, ttlSeconds);
    }

    return addedCount;
  }

  public async sMembers(key: string): Promise<string[]> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.smembers(key);
      } catch (e) {
        console.error('[KeyValueStore] Redis SMEMBERS error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const entry = this.inMemoryStore.get(key);
    if (!entry || entry.type !== 'set') {
      return [];
    }
    return Array.from(entry.value);
  }

  public async sIsMember(key: string, member: string): Promise<boolean> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        const result = await this.redisClient.sismember(key, member);
        return result === 1;
      } catch (e) {
        console.error('[KeyValueStore] Redis SISMEMBER error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const entry = this.inMemoryStore.get(key);
    if (!entry || entry.type !== 'set') {
      return false;
    }
    return entry.value.has(member);
  }

  public async sRem(key: string, members: string | string[]): Promise<number> {
    const memberArray = Array.isArray(members) ? members : [members];

    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.srem(key, ...memberArray);
      } catch (e) {
        console.error('[KeyValueStore] Redis SREM error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const entry = this.inMemoryStore.get(key);
    if (!entry || entry.type !== 'set') {
      return 0;
    }

    let removedCount = 0;
    for (const m of memberArray) {
      if (entry.value.delete(m)) {
        removedCount++;
      }
    }

    if (entry.value.size === 0) {
      this.delInternal(key);
    }

    return removedCount;
  }

  public async sCard(key: string): Promise<number> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.scard(key);
      } catch (e) {
        console.error('[KeyValueStore] Redis SCARD error:', e);
      }
    }

    this.checkPassiveExpiry(key);
    const entry = this.inMemoryStore.get(key);
    if (!entry || entry.type !== 'set') {
      return 0;
    }
    return entry.value.size;
  }

  // --- Teardown & Utility ---

  public async flushAll(): Promise<void> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.flushall();
      } catch (e) {
        console.error('[KeyValueStore] Redis FLUSHALL error:', e);
      }
    }

    for (const key of Array.from(this.inMemoryStore.keys())) {
      this.delInternal(key);
    }
    this.inMemoryStore.clear();
  }

  public async getKeysDetail(): Promise<Array<{ key: string; type: string; ttl: number; value: any }>> {
    await this.ensureRedisConnected();
    if (this.isRedisConnected && this.redisClient) {
      try {
        const keys = await this.redisClient.keys('*');
        const results = [];
        for (const k of keys) {
          const type = await this.redisClient.type(k);
          const ttl = await this.redisClient.ttl(k);
          let value: any = '';
          if (type === 'string') value = await this.redisClient.get(k);
          else if (type === 'set') value = await this.redisClient.smembers(k);
          results.push({ key: k, type, ttl, value });
        }
        return results;
      } catch (e) {
        console.error('[KeyValueStore] Redis getKeysDetail error:', e);
      }
    }

    const results = [];
    for (const [k, entry] of Array.from(this.inMemoryStore.entries())) {
      this.checkPassiveExpiry(k);
      const ttl = await this.ttl(k);
      let value: any = '';
      if (entry.type === 'string') value = entry.value;
      else if (entry.type === 'set') value = Array.from(entry.value);
      results.push({ key: k, type: entry.type, ttl, value });
    }
    return results;
  }

  public async disconnect(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit();
      this.isRedisConnected = false;
    }
  }
}

export const keyValueStore = new KeyValueStore();
