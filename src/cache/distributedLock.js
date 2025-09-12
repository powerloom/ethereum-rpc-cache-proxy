import { getRedisClient } from './redis.js';
import { config } from '../config/index.js';

/**
 * DistributedLock provides Redis-based distributed locking mechanism
 * to prevent race conditions across multiple proxy instances
 */
export class DistributedLock {
  constructor() {
    this.client = null;
    this.enabled = config.distributedLock?.enabled !== false;
    this.defaultTTL = config.distributedLock?.ttl || 5000;
    this.retryAttempts = config.distributedLock?.retryAttempts || 10;
    this.retryDelay = config.distributedLock?.retryDelay || 50;
    this.usingInMemory = false;
    
    // Track active locks for cleanup
    this.activeLocks = new Set();
    
    // Metrics
    this.metrics = {
      locksAcquired: 0,
      locksReleased: 0,
      locksFailed: 0,
      locksExpired: 0,
      contentions: 0
    };
  }

  /**
   * Initialize the distributed lock manager
   * @param {string} cacheType - Type of cache being used ('redis' or 'memory')
   */
  initialize(cacheType) {
    // Disable distributed locking for in-memory cache
    if (cacheType === 'memory') {
      this.enabled = false;
      this.usingInMemory = true;
      if (process.env.NODE_ENV !== 'test') {
        console.log('Distributed locking disabled (using in-memory cache)');
      }
      return;
    }
    
    if (this.enabled) {
      try {
        this.client = getRedisClient();
        
        // Set up cleanup on process exit
        process.on('beforeExit', () => this.releaseAll());
        process.on('SIGINT', () => this.releaseAll());
        process.on('SIGTERM', () => this.releaseAll());
      } catch (error) {
        // If Redis client fails, disable distributed locking
        this.enabled = false;
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Distributed locking disabled due to Redis error:', error.message);
        }
      }
    }
  }

  /**
   * Generate lock key from cache key
   * @param {string} key - Cache key
   * @returns {string} - Lock key
   */
  getLockKey(key) {
    return `lock:${key}`;
  }

  /**
   * Acquire a distributed lock
   * @param {string} key - Resource key to lock
   * @param {number} ttl - Lock TTL in milliseconds (optional)
   * @returns {Promise<boolean>} - True if lock acquired, false otherwise
   */
  async acquireLock(key, ttl = null) {
    if (!this.enabled) {
      return true; // Always succeed when disabled
    }
    
    if (!this.client) {
      console.warn('DistributedLock not initialized. Call initialize() first.');
      return true; // Return true to not block operations
    }

    const lockKey = this.getLockKey(key);
    const lockTTL = ttl || this.defaultTTL;
    const lockValue = `${process.pid}-${Date.now()}`; // Unique identifier for this lock holder
    
    let attempts = 0;
    
    while (attempts < this.retryAttempts) {
      try {
        // Try to set the lock with NX (only if not exists) and PX (TTL in ms)
        const result = await this.client.set(lockKey, lockValue, {
          NX: true,
          PX: lockTTL
        });
        
        if (result === 'OK') {
          // Lock acquired successfully
          this.activeLocks.add(lockKey);
          this.metrics.locksAcquired++;
          console.log(`Lock acquired for key: ${key}`);
          return true;
        }
        
        // Lock is held by someone else
        if (attempts === 0) {
          this.metrics.contentions++;
        }
        
        attempts++;
        
        if (attempts < this.retryAttempts) {
          // Wait before retrying with exponential backoff
          const backoff = Math.min(this.retryDelay * Math.pow(2, attempts - 1), 1000);
          await this.sleep(backoff);
        }
      } catch (error) {
        console.error(`Error acquiring lock for ${key}:`, error);
        this.metrics.locksFailed++;
        return false;
      }
    }
    
    console.warn(`Failed to acquire lock for ${key} after ${attempts} attempts`);
    this.metrics.locksFailed++;
    return false;
  }

  /**
   * Try to acquire lock once without retrying
   * @param {string} key - Resource key to lock
   * @param {number} ttl - Lock TTL in milliseconds
   * @returns {Promise<boolean>} - True if lock acquired
   */
  async tryAcquireLock(key, ttl = null) {
    if (!this.enabled) {
      return true;
    }

    const lockKey = this.getLockKey(key);
    const lockTTL = ttl || this.defaultTTL;
    const lockValue = `${process.pid}-${Date.now()}`;
    
    try {
      const result = await this.client.set(lockKey, lockValue, {
        NX: true,
        PX: lockTTL
      });
      
      if (result === 'OK') {
        this.activeLocks.add(lockKey);
        this.metrics.locksAcquired++;
        return true;
      }
      
      this.metrics.contentions++;
      return false;
    } catch (error) {
      console.error(`Error trying to acquire lock for ${key}:`, error);
      this.metrics.locksFailed++;
      return false;
    }
  }

  /**
   * Release a distributed lock
   * @param {string} key - Resource key to unlock
   * @returns {Promise<boolean>} - True if lock released
   */
  async releaseLock(key) {
    if (!this.enabled) {
      return true;
    }
    
    if (!this.client) {
      // Not initialized, nothing to release
      return true;
    }

    const lockKey = this.getLockKey(key);
    
    try {
      // Delete the lock key
      const result = await this.client.del(lockKey);
      
      if (result > 0) {
        this.activeLocks.delete(lockKey);
        this.metrics.locksReleased++;
        console.log(`Lock released for key: ${key}`);
        return true;
      }
      
      // Lock didn't exist (might have expired)
      this.metrics.locksExpired++;
      return false;
    } catch (error) {
      console.error(`Error releasing lock for ${key}:`, error);
      return false;
    }
  }

  /**
   * Extend lock TTL (useful for long operations)
   * @param {string} key - Resource key
   * @param {number} ttl - New TTL in milliseconds
   * @returns {Promise<boolean>} - True if extended
   */
  async extendLock(key, ttl) {
    if (!this.enabled) {
      return true;
    }

    const lockKey = this.getLockKey(key);
    
    try {
      const result = await this.client.pExpire(lockKey, ttl);
      return result;
    } catch (error) {
      console.error(`Error extending lock for ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if a lock is currently held
   * @param {string} key - Resource key
   * @returns {Promise<boolean>} - True if locked
   */
  async isLocked(key) {
    if (!this.enabled) {
      return false;
    }

    const lockKey = this.getLockKey(key);
    
    try {
      const exists = await this.client.exists(lockKey);
      return exists > 0;
    } catch (error) {
      console.error(`Error checking lock for ${key}:`, error);
      return false;
    }
  }

  /**
   * Execute a function with distributed lock
   * @param {string} key - Resource key
   * @param {Function} fn - Function to execute
   * @param {number} ttl - Lock TTL (optional)
   * @returns {Promise<any>} - Result of function
   */
  async withLock(key, fn, ttl = null) {
    const acquired = await this.acquireLock(key, ttl);
    
    if (!acquired) {
      throw new Error(`Failed to acquire lock for ${key}`);
    }
    
    try {
      return await fn();
    } finally {
      await this.releaseLock(key);
    }
  }

  /**
   * Release all active locks (cleanup)
   */
  async releaseAll() {
    if (!this.enabled || this.activeLocks.size === 0) {
      return;
    }

    console.log(`Releasing ${this.activeLocks.size} active locks...`);
    
    const promises = Array.from(this.activeLocks).map(lockKey => {
      return this.client.del(lockKey).catch(err => {
        console.error(`Error releasing lock ${lockKey}:`, err);
      });
    });
    
    await Promise.all(promises);
    this.activeLocks.clear();
  }

  /**
   * Get lock metrics
   * @returns {Object} - Metrics object
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeLocks: this.activeLocks.size
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.locksAcquired = 0;
    this.metrics.locksReleased = 0;
    this.metrics.locksFailed = 0;
    this.metrics.locksExpired = 0;
    this.metrics.contentions = 0;
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}