import axios from 'axios';
import { config } from '../config/index.js';

export class EthereumService {
  constructor() {
    // Support both single URL and multiple URLs
    this.rpcUrls = config.ethereum.rpcUrls || [config.ethereum.rpcUrl];
    this.currentUrlIndex = 0;
    this.requestId = 0;

    // Track health and performance metrics per URL
    this.urlMetrics = new Map();
    this.rpcUrls.forEach(url => {
      this.urlMetrics.set(url, {
        failureCount: 0,
        successCount: 0,
        lastError: null,
        lastErrorTime: null,
        lastSuccessTime: null,
        isHealthy: true
      });
    });

    // Fallback configuration
    this.maxRetriesPerUrl = config.ethereum.maxRetriesPerUrl || 2;
    this.fallbackEnabled = config.ethereum.fallbackEnabled !== false;
  }

  // Make JSON-RPC call to upstream Ethereum node with automatic fallback
  async callRPC(method, params = []) {
    const requestId = ++this.requestId;
    let lastError = null;
    let attemptCount = 0;

    // Try each RPC URL in sequence until one succeeds
    for (let urlIndex = 0; urlIndex < this.rpcUrls.length; urlIndex++) {
      const rpcUrl = this.rpcUrls[urlIndex];
      const metrics = this.urlMetrics.get(rpcUrl);

      // Skip unhealthy URLs if we have alternatives (unless it's the only one)
      if (!metrics.isHealthy && this.rpcUrls.length > 1 && urlIndex < this.rpcUrls.length - 1) {
        if (process.env.NODE_ENV !== 'test') {
          console.log(`Skipping unhealthy RPC URL: ${this.sanitizeUrl(rpcUrl)}`);
        }
        continue;
      }

      // Try current URL with configured retries
      for (let retry = 0; retry < this.maxRetriesPerUrl; retry++) {
        attemptCount++;

        try {
          if (retry > 0 && process.env.NODE_ENV !== 'test') {
            console.log(`Retry ${retry}/${this.maxRetriesPerUrl} for ${this.sanitizeUrl(rpcUrl)}`);
          }

          const response = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: requestId
          }, {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
          });

          if (response.data.error) {
            throw new Error(`RPC Error: ${response.data.error.message}`);
          }

          // Success! Update metrics
          this.updateUrlMetrics(rpcUrl, true);

          // Log if we used a fallback URL
          if (urlIndex > 0 && process.env.NODE_ENV !== 'test') {
            console.log(`Successfully used fallback RPC URL: ${this.sanitizeUrl(rpcUrl)} after ${attemptCount} total attempts`);
          }

          return response.data.result;

        } catch (error) {
          lastError = error;

          // Update metrics for this URL
          this.updateUrlMetrics(rpcUrl, false, error.message);

          // Determine if we should retry with the same URL or move to next
          if (this.shouldRetryWithSameUrl(error) && retry < this.maxRetriesPerUrl - 1) {
            // Retry with same URL for transient errors
            continue;
          }

          // Log the failure and try next URL
          if (process.env.NODE_ENV !== 'test') {
            const errorMsg = this.getErrorMessage(error);
            if (urlIndex < this.rpcUrls.length - 1) {
              console.error(`RPC call failed on ${this.sanitizeUrl(rpcUrl)}: ${errorMsg}, trying next URL...`);
            } else if (retry === this.maxRetriesPerUrl - 1) {
              console.error(`RPC call failed on ${this.sanitizeUrl(rpcUrl)}: ${errorMsg}, no more URLs to try`);
            }
          }

          // Break inner retry loop to try next URL
          break;
        }
      }
    }

    // All URLs failed - throw the last error
    const errorMessage = this.getErrorMessage(lastError);
    if (process.env.NODE_ENV !== 'test') {
      console.error(`All RPC URLs failed after ${attemptCount} attempts. Last error: ${errorMessage}`);
    }
    throw new Error(`All RPC endpoints failed: ${errorMessage}`);
  }

  // Helper method to sanitize URL for logging (hide API keys)
  sanitizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Hide API key in path (matches v2/..., v3/..., or any long alphanumeric string)
      const sanitized = urlObj.pathname.replace(/\/(v[0-9]+\/)?[a-zA-Z0-9_-]{20,}/, '/[API_KEY]');
      return `${urlObj.protocol}//${urlObj.host}${sanitized}`;
    } catch {
      // If URL parsing fails, just return first part
      return url.substring(0, 30) + '...';
    }
  }

  // Update health metrics for a URL
  updateUrlMetrics(url, success, errorMessage = null) {
    const metrics = this.urlMetrics.get(url);
    if (!metrics) return;

    if (success) {
      metrics.successCount++;
      metrics.lastSuccessTime = Date.now();
      metrics.failureCount = 0; // Reset consecutive failures
      metrics.isHealthy = true;
    } else {
      metrics.failureCount++;
      metrics.lastError = errorMessage;
      metrics.lastErrorTime = Date.now();

      // Mark as unhealthy after 3 consecutive failures
      if (metrics.failureCount >= 3) {
        metrics.isHealthy = false;

        // Schedule health check to re-enable after some time
        if (!metrics.healthCheckTimer) {
          metrics.healthCheckTimer = setTimeout(() => {
            metrics.isHealthy = true;
            metrics.healthCheckTimer = null;
            if (process.env.NODE_ENV !== 'test') {
              console.log(`Re-enabling RPC URL for health check: ${this.sanitizeUrl(url)}`);
            }
          }, 60000); // Re-enable after 1 minute
        }
      }
    }
  }

  // Determine if error is retryable with same URL
  shouldRetryWithSameUrl(error) {
    // Retry on timeout or network errors
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return true;
    }

    // Don't retry on explicit RPC errors
    if (error.message && error.message.includes('RPC Error:')) {
      return false;
    }

    // Retry on connection errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return false; // Move to next URL immediately
    }

    return false;
  }

  // Extract readable error message
  getErrorMessage(error) {
    if (error.response) {
      return error.response.data?.error?.message || error.message;
    } else if (error.request) {
      return `No response (${error.code || 'timeout'})`;
    }
    return error.message || 'Unknown error';
  }

  // Get current health status of all URLs
  getUrlHealthStatus() {
    const status = [];
    this.rpcUrls.forEach(url => {
      const metrics = this.urlMetrics.get(url);
      status.push({
        url: this.sanitizeUrl(url),
        healthy: metrics.isHealthy,
        failureCount: metrics.failureCount,
        successCount: metrics.successCount,
        lastError: metrics.lastError,
        lastErrorTime: metrics.lastErrorTime,
        lastSuccessTime: metrics.lastSuccessTime
      });
    });
    return status;
  }

  // Get latest block number
  async getBlockNumber() {
    const result = await this.callRPC('eth_blockNumber');
    return result;
  }

  // Get block by number
  async getBlockByNumber(blockNumber, includeTransactions = false) {
    const result = await this.callRPC('eth_getBlockByNumber', [blockNumber, includeTransactions]);
    return result;
  }

  // Execute eth_call
  async ethCall(callData, blockTag = 'latest') {
    const result = await this.callRPC('eth_call', [callData, blockTag]);
    return result;
  }

  // Batch RPC calls with automatic fallback
  async batchCall(requests) {
    const batchRequests = requests.map((req, index) => ({
      jsonrpc: '2.0',
      method: req.method,
      params: req.params || [],
      id: index + 1
    }));

    let lastError = null;

    // Try each RPC URL in sequence until one succeeds
    for (let urlIndex = 0; urlIndex < this.rpcUrls.length; urlIndex++) {
      const rpcUrl = this.rpcUrls[urlIndex];
      const metrics = this.urlMetrics.get(rpcUrl);

      // Skip unhealthy URLs if we have alternatives
      if (!metrics.isHealthy && this.rpcUrls.length > 1 && urlIndex < this.rpcUrls.length - 1) {
        continue;
      }

      try {
        const response = await axios.post(rpcUrl, batchRequests, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });

        // Success! Update metrics
        this.updateUrlMetrics(rpcUrl, true);

        // Log if we used a fallback URL
        if (urlIndex > 0 && process.env.NODE_ENV !== 'test') {
          console.log(`Batch call successfully used fallback RPC URL: ${this.sanitizeUrl(rpcUrl)}`);
        }

        // Map responses back to match request order
        const responseMap = {};
        response.data.forEach(res => {
          responseMap[res.id] = res;
        });

        return requests.map((req, index) => {
          const res = responseMap[index + 1];
          if (res.error) {
            return { error: res.error };
          }
          return { result: res.result };
        });

      } catch (error) {
        lastError = error;
        this.updateUrlMetrics(rpcUrl, false, error.message);

        if (process.env.NODE_ENV !== 'test') {
          const errorMsg = this.getErrorMessage(error);
          if (urlIndex < this.rpcUrls.length - 1) {
            console.error(`Batch RPC call failed on ${this.sanitizeUrl(rpcUrl)}: ${errorMsg}, trying next URL...`);
          }
        }
      }
    }

    // All URLs failed
    if (process.env.NODE_ENV !== 'test') {
      console.error('All RPC URLs failed for batch call');
    }
    throw lastError;
  }
}