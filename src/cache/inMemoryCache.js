/**
 * In-memory cache implementation that provides a Redis-like API
 * Used as a fallback when Redis is not available
 */
export class InMemoryCache {
  constructor() {
    this.store = new Map();
    this.ttls = new Map(); // Track TTLs separately
    this.timers = new Map(); // Track expiration timers
  }

  /**
   * Connect method for compatibility with Redis client
   */
  async connect() {
    // No-op for in-memory cache
    return Promise.resolve();
  }

  /**
   * Disconnect method for compatibility with Redis client
   */
  async disconnect() {
    // Clear all timers
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    return Promise.resolve();
  }

  /**
   * Quit method for compatibility with Redis client
   */
  async quit() {
    return this.disconnect();
  }

  /**
   * Get a value from cache
   */
  async get(key) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return value;
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key, value, options = {}) {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    this.store.set(key, value);

    // Handle TTL
    if (options.EX) {
      const ttl = options.EX * 1000; // Convert seconds to milliseconds
      this.ttls.set(key, Date.now() + ttl);
      
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.ttls.delete(key);
        this.timers.delete(key);
      }, ttl);
      
      // Unref the timer so it doesn't block process exit
      if (timer.unref) {
        timer.unref();
      }
      
      this.timers.set(key, timer);
    } else {
      this.ttls.delete(key);
    }

    return 'OK';
  }

  /**
   * Set a value only if it doesn't exist (SET NX)
   * Used for distributed locking
   */
  async setNX(key, value, ttl) {
    if (this.store.has(key)) {
      return null; // Key already exists
    }
    
    await this.set(key, value, { EX: ttl });
    return 'OK';
  }

  /**
   * Delete one or more keys
   */
  async del(...keys) {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.has(key)) {
        this.store.delete(key);
        this.ttls.delete(key);
        
        // Clear timer if exists
        if (this.timers.has(key)) {
          clearTimeout(this.timers.get(key));
          this.timers.delete(key);
        }
        
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Check if a key exists
   */
  async exists(key) {
    return this.store.has(key) ? 1 : 0;
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern) {
    const regex = this.patternToRegex(pattern);
    const matchingKeys = [];
    
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        matchingKeys.push(key);
      }
    }
    
    return matchingKeys;
  }

  /**
   * Clear all keys
   */
  async flushAll() {
    // Clear all timers
    this.timers.forEach(timer => clearTimeout(timer));
    
    this.store.clear();
    this.ttls.clear();
    this.timers.clear();
    
    return 'OK';
  }

  /**
   * Get remaining TTL for a key in seconds
   */
  async ttl(key) {
    if (!this.store.has(key)) {
      return -2; // Key doesn't exist
    }
    
    if (!this.ttls.has(key)) {
      return -1; // Key exists but has no TTL
    }
    
    const expiresAt = this.ttls.get(key);
    const ttl = Math.floor((expiresAt - Date.now()) / 1000);
    
    return ttl > 0 ? ttl : -2;
  }

  /**
   * Set expiration for a key
   */
  async expire(key, seconds) {
    if (!this.store.has(key)) {
      return 0; // Key doesn't exist
    }
    
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }
    
    const ttl = seconds * 1000;
    this.ttls.set(key, Date.now() + ttl);
    
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.ttls.delete(key);
      this.timers.delete(key);
    }, ttl);
    
    this.timers.set(key, timer);
    
    return 1;
  }

  /**
   * Increment a numeric value
   */
  async incr(key) {
    const value = this.store.get(key);
    const newValue = (parseInt(value) || 0) + 1;
    this.store.set(key, String(newValue));
    return newValue;
  }

  /**
   * Decrement a numeric value
   */
  async decr(key) {
    const value = this.store.get(key);
    const newValue = (parseInt(value) || 0) - 1;
    this.store.set(key, String(newValue));
    return newValue;
  }

  /**
   * Convert glob pattern to regex
   */
  patternToRegex(pattern) {
    // Escape special regex characters except * and ?
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Check if cache is connected (always true for in-memory)
   */
  isOpen() {
    return true;
  }

  /**
   * Get cache type identifier
   */
  getType() {
    return 'memory';
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      type: 'memory',
      size: this.store.size,
      ttlCount: this.ttls.size,
      timerCount: this.timers.size
    };
  }
}