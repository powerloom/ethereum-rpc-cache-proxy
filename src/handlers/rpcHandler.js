import { CacheManager } from '../cache/cacheManager.js';
import { EthereumService } from '../services/ethereum.js';
import { RequestCoalescer } from '../cache/requestCoalescer.js';
import { DistributedLock } from '../cache/distributedLock.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { config } from '../config/index.js';
import { shouldCacheMethod, getMethodTTL, generateMethodCacheKey } from '../config/methodCaching.js';

export class RPCHandler {
  constructor() {
    this.cacheManager = new CacheManager();
    this.ethereumService = new EthereumService();
    this.requestCoalescer = new RequestCoalescer();
    this.distributedLock = new DistributedLock();
    
    // Circuit breaker for upstream RPC
    this.circuitBreaker = new CircuitBreaker('upstream-rpc', {
      onStateChange: (oldState, newState) => {
        if (process.env.NODE_ENV !== 'test') {
          console.log(`Circuit breaker state change: ${oldState} -> ${newState}`);
        }
      }
    });
    
    // Enhanced metrics
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      coalescedRequests: 0,
      circuitBreakerRejections: 0,
      staleServed: 0,
      negativeCacheHits: 0,
      lockContentions: 0,
      upstreamErrors: 0
    };
  }

  async initialize() {
    await this.cacheManager.initialize();
    // Pass the cache type to distributed lock
    const cacheType = this.cacheManager.getCacheType();
    this.distributedLock.initialize(cacheType);
  }

  // Handle single JSON-RPC request with all enhancements
  async handleRequest(request) {
    const { jsonrpc, method, params, id } = request;

    // Validate JSON-RPC format
    if (jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request'
        },
        id: id || null
      };
    }

    this.metrics.totalRequests++;
    
    // Declare cacheKey outside try block so it's available in catch
    let cacheKey = null;

    try {
      // Check if method should be cached
      const shouldCache = shouldCacheMethod(method, params);
      
      // For non-cacheable methods, pass through directly to upstream
      if (!shouldCache) {
        try {
          const result = await this.circuitBreaker.execute(
            async () => await this.ethereumService.callRPC(method, params)
          );
          return {
            jsonrpc: '2.0',
            result,
            id,
            cached: false
          };
        } catch (error) {
          this.metrics.upstreamErrors++;
          return {
            jsonrpc: '2.0',
            error: {
              code: error.code || -32603,
              message: error.message || 'Internal error',
              data: error.data
            },
            id
          };
        }
      }

      // Generate cache key using new method-aware function
      cacheKey = generateMethodCacheKey(method, params);
      
      if (!cacheKey) {
        throw new Error(`Failed to generate cache key for ${method}`);
      }

      // Step 1: Check for negative cache (if enabled)
      if (config.advanced?.negativeCaching) {
        const negativeCache = await this.cacheManager.getNegative(cacheKey);
        if (negativeCache) {
          this.metrics.negativeCacheHits++;
          if (process.env.NODE_ENV !== 'test') {
            console.log(`Negative cache hit for ${method}: ${cacheKey}`);
          }
          
          return {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: negativeCache.error,
              data: { cached: true, timestamp: negativeCache.timestamp }
            },
            id
          };
        }
      }

      // Step 2: Try to get from cache (with stale support)
      const cacheResult = config.advanced?.staleWhileRevalidate
        ? await this.cacheManager.getWithStale(cacheKey)
        : { value: await this.cacheManager.get(cacheKey), isStale: false };
      
      if (cacheResult.value !== null) {
        if (cacheResult.isStale) {
          this.metrics.staleServed++;
          if (process.env.NODE_ENV !== 'test') {
            console.log(`Stale cache served for ${method}: ${cacheKey}`);
          }
          
          // Trigger background refresh (don't wait)
          this.refreshInBackground(method, params, cacheKey);
        } else {
          this.metrics.cacheHits++;
          if (process.env.NODE_ENV !== 'test') {
            console.log(`Cache hit for ${method}: ${cacheKey}`);
          }
        }
        
        return {
          jsonrpc: '2.0',
          result: cacheResult.value,
          id,
          cached: true
        };
      }

      // Cache miss - need to fetch from upstream
      this.metrics.cacheMisses++;
      if (process.env.NODE_ENV !== 'test') {
        console.log(`Cache miss for ${method}: ${cacheKey}`);
      }

      // Step 3: Use request coalescing to prevent duplicate requests
      const result = await this.requestCoalescer.getOrFetch(cacheKey, async () => {
        // Step 4: Try to acquire distributed lock (if enabled)
        if (config.distributedLock?.enabled) {
          const lockAcquired = await this.distributedLock.acquireLock(cacheKey);
          
          if (!lockAcquired) {
            this.metrics.lockContentions++;
            if (process.env.NODE_ENV !== 'test') {
              console.log(`Failed to acquire lock for ${cacheKey}, waiting...`);
            }
            
            // Wait a bit and check cache again (another instance might have filled it)
            await this.sleep(100);
            const recheck = await this.cacheManager.get(cacheKey);
            if (recheck !== null) {
              if (process.env.NODE_ENV !== 'test') {
                console.log(`Cache filled by another instance for ${cacheKey}`);
              }
              return recheck;
            }
            
            // If still nothing, proceed anyway (fallback)
            console.warn(`Proceeding without lock for ${cacheKey}`);
          }
          
          try {
            // Double-check cache after acquiring lock
            const doubleCheck = await this.cacheManager.get(cacheKey);
            if (doubleCheck !== null) {
              if (process.env.NODE_ENV !== 'test') {
                console.log(`Cache filled while waiting for lock: ${cacheKey}`);
              }
              return doubleCheck;
            }
            
            // Fetch with circuit breaker protection
            return await this.fetchWithCircuitBreaker(method, params, cacheKey);
          } finally {
            // Always release lock
            if (lockAcquired) {
              await this.distributedLock.releaseLock(cacheKey);
            }
          }
        } else {
          // No distributed lock, just fetch
          return await this.fetchWithCircuitBreaker(method, params, cacheKey);
        }
      });

      // Check if this request was coalesced
      if (this.requestCoalescer.getMetrics().totalCoalesced > this.metrics.coalescedRequests) {
        this.metrics.coalescedRequests = this.requestCoalescer.getMetrics().totalCoalesced;
      }

      return {
        jsonrpc: '2.0',
        result,
        id,
        cached: false
      };

    } catch (error) {
      // Only log errors in non-test environments
      if (process.env.NODE_ENV !== 'test') {
        console.error(`Error handling ${method}:`, error);
      }
      this.metrics.upstreamErrors++;
      
      // Check if circuit is open
      if (error.code === 'CIRCUIT_OPEN') {
        this.metrics.circuitBreakerRejections++;
        
        // Try to serve stale data if available
        if (config.advanced?.staleWhileRevalidate) {
          const staleResult = await this.cacheManager.getWithStale(cacheKey);
          if (staleResult.value !== null) {
            if (process.env.NODE_ENV !== 'test') {
              console.log(`Serving stale data due to circuit open: ${cacheKey}`);
            }
            this.metrics.staleServed++;
            
            return {
              jsonrpc: '2.0',
              result: staleResult.value,
              id,
              cached: true
            };
          }
        }
      }
      
      // Cache negative result if enabled
      if (config.advanced?.negativeCaching && cacheKey) {
        await this.cacheManager.setNegative(cacheKey, error);
      }
      
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        },
        id
      };
    }
  }

  // Fetch from upstream with circuit breaker protection
  async fetchWithCircuitBreaker(method, params, cacheKey) {
    return await this.circuitBreaker.execute(async () => {
      let result;
      
      // Call the RPC method through the generic interface
      // All methods are now supported
      result = await this.ethereumService.callRPC(method, params);

      // Cache the result if we have a cache key
      if (cacheKey && result !== null) {
        const ttl = getMethodTTL(method, params);
        
        // Use enhanced caching if enabled
        if (config.advanced?.staleWhileRevalidate) {
          await this.cacheManager.setWithStale(cacheKey, result, ttl);
        } else {
          await this.cacheManager.set(cacheKey, result, ttl);
        }
        
        if (process.env.NODE_ENV !== 'test') {
          console.log(`Cached result for ${method}: ${cacheKey} with TTL: ${ttl || 'permanent'}`);
        }
      }

      return result;
    });
  }

  // Background refresh for stale-while-revalidate
  async refreshInBackground(method, params, cacheKey) {
    try {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`Starting background refresh for ${cacheKey}`);
      }
      
      // Don't use coalescing for background refresh
      const result = await this.fetchWithCircuitBreaker(method, params, cacheKey);
      
      if (process.env.NODE_ENV !== 'test') {
        console.log(`Background refresh completed for ${cacheKey}`);
      }
      return result;
    } catch (error) {
      console.error(`Background refresh failed for ${cacheKey}:`, error);
      // Don't throw - this is background work
    }
  }

  // Handle batch requests
  async handleBatchRequest(requests) {
    if (!Array.isArray(requests) || requests.length === 0) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request'
        },
        id: null
      };
    }

    // Process each request in parallel
    const responses = await Promise.all(
      requests.map(request => this.handleRequest(request))
    );

    return responses;
  }

  // Get enhanced metrics
  getMetrics() {
    const hitRate = this.metrics.totalRequests > 0 
      ? (this.metrics.cacheHits / this.metrics.totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.metrics,
      cacheHitRate: `${hitRate}%`,
      coalescing: this.requestCoalescer.getMetrics(),
      circuitBreaker: this.circuitBreaker.getMetrics(),
      distributedLock: this.distributedLock.getMetrics()
    };
  }

  // Reset metrics
  resetMetrics() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      coalescedRequests: 0,
      circuitBreakerRejections: 0,
      staleServed: 0,
      negativeCacheHits: 0,
      lockContentions: 0,
      upstreamErrors: 0
    };
    
    this.requestCoalescer.resetMetrics();
    this.circuitBreaker.resetMetrics();
    this.distributedLock.resetMetrics();
  }

  // Sleep helper
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup on shutdown
  async cleanup() {
    await this.distributedLock.releaseAll();
    this.requestCoalescer.clearAll();
  }
}