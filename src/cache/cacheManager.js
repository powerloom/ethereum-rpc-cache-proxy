import { getRedisClient } from './redis.js';
import { InMemoryCache } from './inMemoryCache.js';
import { config } from '../config/index.js';

export class CacheManager {
  constructor() {
    this.client = null;
    this.staleKeys = new Map(); // Track stale data for stale-while-revalidate
    this.cacheType = null;
  }

  async initialize() {
    // Determine cache type based on configuration
    if (!config.redis.url || config.redis.url === 'memory' || config.cache.type === 'memory') {
      // Use in-memory cache
      this.client = new InMemoryCache();
      this.cacheType = 'memory';
      await this.client.connect();
      if (process.env.NODE_ENV !== 'test') {
        console.log('Using in-memory cache (Redis not configured)');
      }
    } else {
      // Try to use Redis
      try {
        this.client = getRedisClient();
        // Test connection
        await this.client.ping();
        this.cacheType = 'redis';
        if (process.env.NODE_ENV !== 'test') {
          console.log('Using Redis cache');
        }
      } catch (error) {
        // Fall back to in-memory cache if Redis fails
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Redis connection failed, falling back to in-memory cache:', error.message);
        }
        this.client = new InMemoryCache();
        this.cacheType = 'memory';
        await this.client.connect();
      }
    }
  }

  // Legacy method - no longer used (replaced by methodCaching.js)
  generateCacheKey(method, params) {
    // This method is deprecated - see methodCaching.js
    return null;
  }

  // Legacy method - no longer used (replaced by methodCaching.js)
  getTTL(method, params) {
    // This method is deprecated - see methodCaching.js
    return null;
  }

  // Get cached value
  async get(key) {
    if (!key) return null;
    if (!this.client) {
      console.warn('CacheManager not initialized. Call initialize() first.');
      return null;
    }
    
    try {
      const value = await this.client.get(key);
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      // Only log actual errors, not expected JSON parse failures
      if (error.name !== 'SyntaxError') {
        console.error(`Cache get error for key ${key}:`, error);
      }
      return null;
    }
  }

  // Set cache value with optional TTL
  async set(key, value, ttl = null) {
    if (!key) return false;
    
    try {
      const stringValue = JSON.stringify(value);
      
      if (ttl === null) {
        // Permanent cache
        await this.client.set(key, stringValue);
      } else {
        // Cache with TTL
        await this.client.set(key, stringValue, {
          EX: ttl
        });
      }
      
      return true;
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  // Legacy method - no longer used (replaced by methodCaching.js)
  isCacheable(method, params) {
    // This method is deprecated - see methodCaching.js
    return false;
  }

  // Clear all cache (useful for testing)
  async flush() {
    try {
      await this.client.flushAll();
      if (process.env.NODE_ENV !== 'test') {
        console.log('Cache flushed');
      }
      return true;
    } catch (error) {
      console.error('Cache flush error:', error);
      return false;
    }
  }

  // Get cache statistics
  async getStats() {
    try {
      if (this.cacheType === 'memory') {
        // Get stats from in-memory cache
        return this.client.getStats();
      } else {
        // Get stats from Redis
        const info = await this.client.info('stats');
        const dbSize = await this.client.dbSize();
        
        return {
          type: 'redis',
          dbSize,
          info
        };
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Failed to get cache stats:', error);
      }
      return null;
    }
  }

  // Get cache type
  getCacheType() {
    return this.cacheType;
  }

  // Atomic set if not exists (for distributed locking)
  async setNX(key, value, ttl = null) {
    if (!key) return false;
    
    try {
      const options = { NX: true };
      if (ttl) {
        options.EX = ttl;
      }
      
      const result = await this.client.set(key, value, options);
      return result === 'OK';
    } catch (error) {
      console.error(`SetNX error for key ${key}:`, error);
      return false;
    }
  }

  // Get with stale-while-revalidate support
  async getWithStale(key) {
    if (!key) return { value: null, isStale: false };
    if (!this.client) {
      console.warn('CacheManager not initialized. Call initialize() first.');
      return { value: null, isStale: false };
    }
    
    try {
      // Try to get fresh value
      const value = await this.client.get(key);
      if (value) {
        return { value: JSON.parse(value), isStale: false };
      }
      
      // Check for stale value if enabled
      if (config.advanced?.staleWhileRevalidate) {
        const staleKey = `stale:${key}`;
        const staleValue = await this.client.get(staleKey);
        if (staleValue) {
          return { value: JSON.parse(staleValue), isStale: true };
        }
      }
      
      return { value: null, isStale: false };
    } catch (error) {
      console.error(`Get with stale error for key ${key}:`, error);
      return { value: null, isStale: false };
    }
  }

  // Set with stale copy for stale-while-revalidate
  async setWithStale(key, value, ttl = null) {
    if (!key) return false;
    if (!this.client) {
      console.warn('CacheManager not initialized. Call initialize() first.');
      return false;
    }
    
    try {
      const stringValue = JSON.stringify(value);
      
      // Set main cache
      const setPromise = ttl === null 
        ? this.client.set(key, stringValue)
        : this.client.set(key, stringValue, { EX: ttl });
      
      // Set stale copy if enabled
      let stalePromise = Promise.resolve();
      if (config.advanced?.staleWhileRevalidate && ttl !== null) {
        const staleTtl = ttl + (config.advanced.staleTtl || 300);
        const staleKey = `stale:${key}`;
        stalePromise = this.client.set(staleKey, stringValue, { EX: staleTtl });
      }
      
      await Promise.all([setPromise, stalePromise]);
      return true;
    } catch (error) {
      // Only log if client was initialized
      if (this.client) {
        console.error(`Set with stale error for key ${key}:`, error);
      }
      return false;
    }
  }

  // Cache negative results (errors/not found)
  async setNegative(key, error) {
    if (!config.advanced?.negativeCaching || !key) return false;
    
    try {
      const negativeKey = `negative:${key}`;
      const ttl = config.advanced.negativeTtl || 60;
      
      await this.client.set(negativeKey, JSON.stringify({
        error: error.message || 'Not found',
        timestamp: Date.now()
      }), { EX: ttl });
      
      return true;
    } catch (err) {
      console.error(`Set negative error for key ${key}:`, err);
      return false;
    }
  }

  // Check for negative cache
  async getNegative(key) {
    if (!config.advanced?.negativeCaching || !key) return null;
    if (!this.client) {
      console.warn('CacheManager not initialized. Call initialize() first.');
      return null;
    }
    
    try {
      const negativeKey = `negative:${key}`;
      const value = await this.client.get(negativeKey);
      
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      // Only log if client was initialized (not a test setup issue)
      if (this.client) {
        console.error(`Get negative error for key ${key}:`, error);
      }
      return null;
    }
  }

  // Multi-get for batch operations
  async mGet(keys) {
    if (!keys || keys.length === 0) return [];
    
    try {
      const values = await this.client.mGet(keys);
      return values.map(v => v ? JSON.parse(v) : null);
    } catch (error) {
      console.error('Multi-get error:', error);
      return keys.map(() => null);
    }
  }

  // Multi-set for batch operations
  async mSet(entries, ttl = null) {
    if (!entries || entries.length === 0) return false;
    
    try {
      if (ttl === null) {
        // Use MSET for permanent cache
        const pairs = entries.flatMap(([key, value]) => [key, JSON.stringify(value)]);
        await this.client.mSet(pairs);
      } else {
        // Use pipeline for TTL support
        const pipeline = this.client.multi();
        entries.forEach(([key, value]) => {
          pipeline.set(key, JSON.stringify(value), { EX: ttl });
        });
        await pipeline.exec();
      }
      return true;
    } catch (error) {
      console.error('Multi-set error:', error);
      return false;
    }
  }

  // Delete multiple keys
  async deleteKeys(pattern) {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        if (process.env.NODE_ENV !== 'test') {
          console.log(`Deleted ${keys.length} keys matching pattern: ${pattern}`);
        }
      }
      return keys.length;
    } catch (error) {
      console.error(`Delete keys error for pattern ${pattern}:`, error);
      return 0;
    }
  }
}