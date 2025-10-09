import dotenv from 'dotenv';

// Load environment variables quietly in test mode
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ quiet: true });
} else {
  dotenv.config();
}

// Parse RPC URLs - support both single and comma-separated multiple URLs
const parseRpcUrls = (urlString) => {
  if (!urlString) return null;

  // Check if multiple URLs are provided (comma-separated)
  if (urlString.includes(',')) {
    return urlString.split(',').map(url => url.trim()).filter(url => url);
  }

  // Single URL - return null to maintain backward compatibility
  return null;
};

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0'
  },
  ethereum: {
    rpcUrl: process.env.UPSTREAM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
    // Auto-detect multiple URLs if comma-separated
    rpcUrls: parseRpcUrls(process.env.UPSTREAM_RPC_URL),
    // Fallback configuration
    maxRetriesPerUrl: parseInt(process.env.RPC_MAX_RETRIES_PER_URL || '2', 10),
    fallbackEnabled: process.env.RPC_FALLBACK_ENABLED !== 'false' // default true
  },
  redis: {
    url: process.env.REDIS_URL // No default - will use in-memory if not provided
  },
  cache: {
    type: process.env.CACHE_TYPE || 'auto', // 'redis', 'memory', or 'auto'
    permanentCacheHeight: parseInt(process.env.PERMANENT_CACHE_HEIGHT || '15537393', 10), // Default to merge block
    latestBlockTtl: parseInt(process.env.LATEST_BLOCK_TTL || '2', 10), // seconds
    ethCallTtl: parseInt(process.env.ETH_CALL_TTL || '300', 10), // 5 minutes default for all eth_call
    recentBlockTtl: parseInt(process.env.RECENT_BLOCK_TTL || '60', 10) // 1 minute for recent blocks
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.NODE_ENV !== 'production'
  },
  coalescing: {
    enabled: process.env.COALESCING_ENABLED !== 'false',
    inFlightTimeout: parseInt(process.env.COALESCING_TIMEOUT || '30000', 10), // 30 seconds
    maxRetries: parseInt(process.env.COALESCING_MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.COALESCING_RETRY_DELAY || '1000', 10) // 1 second
  },
  distributedLock: {
    enabled: process.env.DISTRIBUTED_LOCK_ENABLED !== 'false',
    ttl: parseInt(process.env.LOCK_TTL || '5000', 10), // 5 seconds
    retryAttempts: parseInt(process.env.LOCK_RETRY_ATTEMPTS || '10', 10),
    retryDelay: parseInt(process.env.LOCK_RETRY_DELAY || '50', 10) // 50ms
  },
  circuitBreaker: {
    enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
    failureThreshold: parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5', 10),
    successThreshold: parseInt(process.env.CIRCUIT_SUCCESS_THRESHOLD || '2', 10),
    timeout: parseInt(process.env.CIRCUIT_TIMEOUT || '10000', 10), // 10 seconds
    resetTimeout: parseInt(process.env.CIRCUIT_RESET_TIMEOUT || '60000', 10), // 1 minute
    volumeThreshold: parseInt(process.env.CIRCUIT_VOLUME_THRESHOLD || '10', 10),
    errorThresholdPercentage: parseInt(process.env.CIRCUIT_ERROR_PERCENTAGE || '50', 10)
  },
  advanced: {
    staleWhileRevalidate: process.env.STALE_WHILE_REVALIDATE === 'true',
    staleTtl: parseInt(process.env.STALE_TTL || '300', 10), // 5 minutes
    negativeCaching: process.env.NEGATIVE_CACHING === 'true',
    negativeTtl: parseInt(process.env.NEGATIVE_TTL || '60', 10), // 1 minute
    cacheWarming: process.env.CACHE_WARMING === 'true',
    warmingInterval: parseInt(process.env.WARMING_INTERVAL || '300000', 10) // 5 minutes
  }
};