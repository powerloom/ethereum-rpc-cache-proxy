import { config } from '../config/index.js';

/**
 * Circuit Breaker States
 */
const State = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',          // Failing, reject requests
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * CircuitBreaker prevents cascading failures by temporarily blocking
 * requests to a failing service
 */
export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    
    // Configuration
    this.failureThreshold = options.failureThreshold || config.circuitBreaker?.failureThreshold || 5;
    this.successThreshold = options.successThreshold || config.circuitBreaker?.successThreshold || 2;
    this.timeout = options.timeout || config.circuitBreaker?.timeout || 10000;
    this.resetTimeout = options.resetTimeout || config.circuitBreaker?.resetTimeout || 60000;
    this.volumeThreshold = options.volumeThreshold || config.circuitBreaker?.volumeThreshold || 10;
    this.errorThresholdPercentage = options.errorThresholdPercentage || config.circuitBreaker?.errorThresholdPercentage || 50;
    
    // State
    this.state = State.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = Date.now();
    this.requestCount = 0;
    
    // Metrics for rolling window
    this.rollingWindow = [];
    this.windowSize = options.windowSize || 10000; // 10 seconds
    
    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      totalRejections: 0,
      stateChanges: 0,
      lastFailureTime: null,
      lastSuccessTime: null
    };
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise} - Result of function or error
   */
  async execute(fn) {
    this.metrics.totalRequests++;
    
    // Check if circuit should be in HALF_OPEN state
    if (this.state === State.OPEN && Date.now() >= this.nextAttempt) {
      this.transition(State.HALF_OPEN);
    }
    
    // Reject if circuit is OPEN
    if (this.state === State.OPEN) {
      this.metrics.totalRejections++;
      const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
      error.code = 'CIRCUIT_OPEN';
      throw error;
    }
    
    try {
      // Add timeout protection
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Execute function with timeout
   * @param {Function} fn - Function to execute
   * @returns {Promise} - Result or timeout error
   */
  async executeWithTimeout(fn) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Circuit breaker timeout for ${this.name} after ${this.timeout}ms`));
      }, this.timeout);
      
      try {
        const result = await fn();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Record successful execution
   */
  onSuccess() {
    this.failures = 0;
    this.metrics.totalSuccesses++;
    this.metrics.lastSuccessTime = Date.now();
    
    // Add to rolling window
    this.addToRollingWindow(true);
    
    switch (this.state) {
      case State.HALF_OPEN:
        this.successes++;
        if (this.successes >= this.successThreshold) {
          this.transition(State.CLOSED);
        }
        break;
      case State.CLOSED:
        // Reset any partial failure count
        this.failures = 0;
        break;
    }
  }

  /**
   * Record failed execution
   */
  onFailure() {
    this.successes = 0;
    this.failures++;
    this.metrics.totalFailures++;
    this.metrics.lastFailureTime = Date.now();
    
    // Add to rolling window
    this.addToRollingWindow(false);
    
    switch (this.state) {
      case State.HALF_OPEN:
        this.transition(State.OPEN);
        break;
      case State.CLOSED:
        if (this.shouldTrip()) {
          this.transition(State.OPEN);
        }
        break;
    }
  }

  /**
   * Check if circuit should trip to OPEN
   * @returns {boolean} - True if should trip
   */
  shouldTrip() {
    // Simple threshold check
    if (this.failures >= this.failureThreshold) {
      return true;
    }
    
    // Percentage-based check with volume threshold
    const stats = this.getRollingStats();
    if (stats.total >= this.volumeThreshold) {
      const errorPercentage = (stats.failures / stats.total) * 100;
      return errorPercentage >= this.errorThresholdPercentage;
    }
    
    return false;
  }

  /**
   * Transition to a new state
   * @param {string} newState - New state
   */
  transition(newState) {
    const oldState = this.state;
    this.state = newState;
    this.metrics.stateChanges++;
    
    if (process.env.NODE_ENV !== 'test') {
      console.log(`Circuit breaker ${this.name}: ${oldState} -> ${newState}`);
    }
    
    switch (newState) {
      case State.OPEN:
        this.nextAttempt = Date.now() + this.resetTimeout;
        break;
      case State.HALF_OPEN:
        this.successes = 0;
        this.failures = 0;
        break;
      case State.CLOSED:
        this.successes = 0;
        this.failures = 0;
        break;
    }
    
    // Notify state change
    this.onStateChange(oldState, newState, this.name);
  }

  /**
   * Add result to rolling window
   * @param {boolean} success - Whether request succeeded
   */
  addToRollingWindow(success) {
    const now = Date.now();
    
    // Remove old entries
    this.rollingWindow = this.rollingWindow.filter(
      entry => now - entry.timestamp < this.windowSize
    );
    
    // Add new entry
    this.rollingWindow.push({
      timestamp: now,
      success
    });
  }

  /**
   * Get rolling window statistics
   * @returns {Object} - Stats object
   */
  getRollingStats() {
    const now = Date.now();
    const validEntries = this.rollingWindow.filter(
      entry => now - entry.timestamp < this.windowSize
    );
    
    const total = validEntries.length;
    const successes = validEntries.filter(e => e.success).length;
    const failures = total - successes;
    
    return {
      total,
      successes,
      failures,
      successRate: total > 0 ? (successes / total) * 100 : 0
    };
  }

  /**
   * Force circuit to OPEN state
   */
  trip() {
    if (this.state !== State.OPEN) {
      this.transition(State.OPEN);
    }
  }

  /**
   * Force circuit to CLOSED state
   */
  reset() {
    if (this.state !== State.CLOSED) {
      this.transition(State.CLOSED);
    }
  }

  /**
   * Force circuit to HALF_OPEN state
   */
  attemptReset() {
    if (this.state === State.OPEN) {
      this.transition(State.HALF_OPEN);
    }
  }

  /**
   * Get current state
   * @returns {string} - Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if requests are allowed
   * @returns {boolean} - True if requests allowed
   */
  isAllowed() {
    if (this.state === State.OPEN && Date.now() >= this.nextAttempt) {
      this.transition(State.HALF_OPEN);
    }
    return this.state !== State.OPEN;
  }

  /**
   * Get circuit breaker metrics
   * @returns {Object} - Metrics object
   */
  getMetrics() {
    const rollingStats = this.getRollingStats();
    
    return {
      ...this.metrics,
      state: this.state,
      currentFailures: this.failures,
      currentSuccesses: this.successes,
      rollingWindow: rollingStats,
      nextAttemptIn: this.state === State.OPEN ? 
        Math.max(0, this.nextAttempt - Date.now()) : 0
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.totalRequests = 0;
    this.metrics.totalFailures = 0;
    this.metrics.totalSuccesses = 0;
    this.metrics.totalRejections = 0;
    this.metrics.stateChanges = 0;
    this.metrics.lastFailureTime = null;
    this.metrics.lastSuccessTime = null;
    this.rollingWindow = [];
  }
}

/**
 * Factory function to create circuit breakers
 * @param {string} name - Circuit breaker name
 * @param {Object} options - Options
 * @returns {CircuitBreaker} - New circuit breaker
 */
export function createCircuitBreaker(name, options = {}) {
  return new CircuitBreaker(name, options);
}