import { config } from '../config/index.js';

/**
 * RequestCoalescer prevents duplicate concurrent requests to the same resource
 * by tracking in-flight requests and allowing subsequent requests to wait for
 * the first one to complete.
 */
export class RequestCoalescer {
  constructor() {
    // Map of cache key to Promise of the fetch operation
    this.inFlightRequests = new Map();
    
    // Metrics for monitoring
    this.metrics = {
      totalCoalesced: 0,
      currentInFlight: 0,
      timeouts: 0,
      failures: 0
    };
    
    // Configuration
    this.timeout = config.coalescing?.inFlightTimeout || 30000;
    this.enabled = config.coalescing?.enabled !== false;
  }

  /**
   * Get or fetch a resource with request coalescing
   * @param {string} key - Unique key for the request
   * @param {Function} fetchFn - Async function to fetch the resource
   * @returns {Promise} - Promise resolving to the fetched resource
   */
  async getOrFetch(key, fetchFn) {
    if (!this.enabled) {
      // Coalescing disabled, just execute fetch
      return fetchFn();
    }

    // Check if request is already in flight
    if (this.inFlightRequests.has(key)) {
      this.metrics.totalCoalesced++;
      if (process.env.NODE_ENV !== 'test') {
        console.log(`Coalescing request for key: ${key}`);
      }
      
      // Wait for existing request to complete
      try {
        return await this.inFlightRequests.get(key);
      } catch (error) {
        // If the original request failed, subsequent waiters might want to retry
        // But we'll let the caller handle that decision
        throw error;
      }
    }

    // No in-flight request, start a new one
    this.metrics.currentInFlight++;
    
    // Create promise that will be shared by all concurrent requests
    const fetchPromise = this.createTimedFetch(key, fetchFn);
    
    // Store the promise so other requests can wait on it
    this.inFlightRequests.set(key, fetchPromise);
    
    try {
      const result = await fetchPromise;
      return result;
    } finally {
      // Always clean up, regardless of success or failure
      this.cleanup(key);
    }
  }

  /**
   * Create a fetch promise with timeout
   * @param {string} key - Request key
   * @param {Function} fetchFn - Fetch function
   * @returns {Promise} - Promise with timeout
   */
  createTimedFetch(key, fetchFn) {
    return new Promise(async (resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.metrics.timeouts++;
        reject(new Error(`Request timeout for key: ${key} after ${this.timeout}ms`));
      }, this.timeout);

      try {
        // Execute the actual fetch
        const result = await fetchFn();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        this.metrics.failures++;
        reject(error);
      }
    });
  }

  /**
   * Clean up in-flight request tracking
   * @param {string} key - Request key to clean up
   */
  cleanup(key) {
    if (this.inFlightRequests.has(key)) {
      this.inFlightRequests.delete(key);
      this.metrics.currentInFlight--;
    }
  }

  /**
   * Force cleanup of a specific request (useful for error recovery)
   * @param {string} key - Request key
   */
  forceCleanup(key) {
    this.cleanup(key);
  }

  /**
   * Clear all in-flight requests (useful for shutdown)
   */
  clearAll() {
    this.inFlightRequests.clear();
    this.metrics.currentInFlight = 0;
  }

  /**
   * Get current metrics
   * @returns {Object} - Metrics object
   */
  getMetrics() {
    return {
      ...this.metrics,
      inFlightKeys: Array.from(this.inFlightRequests.keys())
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.totalCoalesced = 0;
    this.metrics.timeouts = 0;
    this.metrics.failures = 0;
    // Don't reset currentInFlight as it's a gauge, not a counter
  }

  /**
   * Check if a request is currently in flight
   * @param {string} key - Request key
   * @returns {boolean} - True if request is in flight
   */
  isInFlight(key) {
    return this.inFlightRequests.has(key);
  }

  /**
   * Get number of currently in-flight requests
   * @returns {number} - Number of in-flight requests
   */
  getInFlightCount() {
    return this.inFlightRequests.size;
  }
}