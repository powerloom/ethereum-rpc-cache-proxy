/**
 * Comprehensive Ethereum RPC Method Caching Configuration
 * 
 * This file defines caching strategies for all Ethereum RPC methods.
 * Methods are categorized by their data characteristics to apply appropriate caching.
 */

import { config } from './index.js';

// Helper to extract block number from params
function extractBlockNumber(params) {
  if (!params || params.length === 0) return null;
  
  const blockParam = params[0];
  if (typeof blockParam === 'string') {
    if (blockParam === 'latest' || blockParam === 'pending' || blockParam === 'earliest') {
      return blockParam;
    }
    // Convert hex to number
    return parseInt(blockParam, 16);
  }
  
  // For methods with block as second parameter
  if (params.length > 1 && typeof params[1] === 'string') {
    const block = params[1];
    if (block === 'latest' || block === 'pending' || block === 'earliest') {
      return block;
    }
    return parseInt(block, 16);
  }
  
  return null;
}

// Caching rules for each method category
export const METHOD_CACHE_RULES = {
  // ============= IMMUTABLE DATA - Cache Forever =============
  immutable: {
    methods: [
      'eth_getTransactionByHash',           // Transaction details (once mined)
      'eth_getTransactionReceipt',          // Transaction receipts (once confirmed)
      'eth_getBlockByHash',                 // Historical blocks by hash
      'eth_getTransactionByBlockHashAndIndex',
      'eth_getTransactionByBlockNumberAndIndex',
      'eth_getUncleByBlockHashAndIndex',
      'eth_getUncleByBlockNumberAndIndex'
    ],
    getTTL: (method, params) => {
      // For transaction-related methods, only cache if transaction exists
      // Return null for permanent cache, 0 for no cache
      if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') {
        // We'll cache after verifying the transaction exists in the response
        return null; // Permanent cache
      }
      return null; // Permanent cache for blocks by hash
    }
  },

  // ============= BLOCK DATA - Cache Based on Finality =============
  blocks: {
    methods: [
      'eth_blockNumber',
      'eth_getBlockByNumber',
      'eth_getBlockTransactionCountByHash',
      'eth_getBlockTransactionCountByNumber',
      'eth_getUncleCountByBlockHash',
      'eth_getUncleCountByBlockNumber'
    ],
    getTTL: (method, params) => {
      if (method === 'eth_blockNumber') {
        return config.cache.latestBlockTtl || 2; // 2 seconds default
      }
      
      const blockNum = extractBlockNumber(params);
      
      // Handle special block tags
      if (blockNum === 'latest') {
        return config.cache.latestBlockTtl || 2;
      }
      if (blockNum === 'pending') {
        return 1; // Very short cache for pending
      }
      if (blockNum === 'earliest') {
        return 3600; // 1 hour for genesis block
      }
      
      // Numeric block numbers
      if (typeof blockNum === 'number') {
        const permanentHeight = config.cache.permanentCacheHeight || 15537393;
        
        // Permanent cache for old blocks
        if (blockNum <= permanentHeight) {
          return null; // No expiration
        }
        
        // Recent blocks - short TTL
        return config.cache.recentBlockTtl || 60; // 60 seconds default
      }
      
      return 30; // Default fallback
    }
  },

  // ============= ACCOUNT STATE - Short TTL =============
  accountState: {
    methods: [
      'eth_getBalance',
      'eth_getTransactionCount',
      'eth_getCode',
      'eth_getStorageAt'
    ],
    getTTL: (method, params) => {
      // eth_getCode can have longer TTL as contract code rarely changes
      if (method === 'eth_getCode') {
        return 300; // 5 minutes
      }
      
      // Check if querying historical state (specific block number)
      const blockNum = extractBlockNumber(params);
      if (typeof blockNum === 'number') {
        const permanentHeight = config.cache.permanentCacheHeight || 15537393;
        if (blockNum <= permanentHeight) {
          return null; // Permanent for historical queries
        }
        return 300; // 5 minutes for recent historical
      }
      
      // Latest state - short cache
      return 15; // 15 seconds for balance, nonce
    }
  },

  // ============= GAS & PRICING - Very Short TTL =============
  gas: {
    methods: [
      'eth_gasPrice',
      'eth_estimateGas',
      'eth_maxPriorityFeePerGas',
      'eth_feeHistory'
    ],
    getTTL: (method, params) => {
      if (method === 'eth_feeHistory') {
        // Can cache longer if querying old blocks
        const blockNum = extractBlockNumber(params);
        if (typeof blockNum === 'number' && blockNum < (config.cache.permanentCacheHeight || 15537393)) {
          return 3600; // 1 hour for historical fee data
        }
      }
      
      // Very short cache for current gas prices
      return 5; // 5 seconds
    }
  },

  // ============= LOGS & FILTERS - Cache Based on Block Range =============
  logs: {
    methods: [
      'eth_getLogs',
      'eth_getFilterLogs'
    ],
    getTTL: (method, params) => {
      if (method === 'eth_getLogs' && params && params[0]) {
        const filter = params[0];
        
        // Check if filter has specific block range
        if (filter.fromBlock && filter.toBlock) {
          const from = extractBlockNumber([filter.fromBlock]);
          const to = extractBlockNumber([filter.toBlock]);
          
          // If both are specific numbers and in the past, cache longer
          if (typeof from === 'number' && typeof to === 'number') {
            const permanentHeight = config.cache.permanentCacheHeight || 15537393;
            if (to <= permanentHeight) {
              return null; // Permanent for old ranges
            }
            return 300; // 5 minutes for recent ranges
          }
        }
      }
      
      return 10; // Short cache for dynamic queries
    }
  },

  // ============= NETWORK INFO - Long TTL =============
  network: {
    methods: [
      'net_version',
      'eth_chainId',
      'net_listening',
      'net_peerCount',
      'web3_clientVersion',
      'eth_protocolVersion',
      'eth_syncing'
    ],
    getTTL: (method, params) => {
      // Chain ID and version rarely change
      if (method === 'eth_chainId' || method === 'net_version') {
        return 3600; // 1 hour
      }
      
      // Sync status changes more frequently
      if (method === 'eth_syncing') {
        return 30; // 30 seconds
      }
      
      return 300; // 5 minutes default
    }
  },

  // ============= CONTRACT CALLS - Configurable TTL =============
  contractCalls: {
    methods: [
      'eth_call',
      'eth_createAccessList'
    ],
    getTTL: (method, params) => {
      if (method === 'eth_call') {
        // Check if calling specific contract we want to cache
        if (params && params[0]) {
          const callParams = params[0];
          const blockTag = params[1] || 'latest';
          
          // Historical calls can be cached longer
          if (blockTag !== 'latest' && blockTag !== 'pending') {
            const blockNum = extractBlockNumber([blockTag]);
            if (typeof blockNum === 'number' && blockNum <= (config.cache.permanentCacheHeight || 15537393)) {
              return null; // Permanent for historical calls
            }
            return 300; // 5 minutes for recent historical
          }
          
        }
        
        return config.cache.ethCallTtl || 300; // Use configured TTL for all eth_call
      }
      
      return 60; // 1 minute for access list
    }
  },

  // ============= MINING/STAKING - Short TTL =============
  mining: {
    methods: [
      'eth_mining',
      'eth_hashrate',
      'eth_getWork'
    ],
    getTTL: (method, params) => {
      return 10; // 10 seconds
    }
  },

  // ============= PROOF METHODS - Cache Based on Block =============
  proofs: {
    methods: [
      'eth_getProof'
    ],
    getTTL: (method, params) => {
      // Check block parameter
      if (params && params.length > 2) {
        const blockNum = extractBlockNumber([params[2]]);
        if (typeof blockNum === 'number' && blockNum <= (config.cache.permanentCacheHeight || 15537393)) {
          return null; // Permanent for old proofs
        }
      }
      return 60; // 1 minute default
    }
  },

  // ============= NEVER CACHE - Write Operations =============
  neverCache: {
    methods: [
      'eth_sendTransaction',
      'eth_sendRawTransaction',
      'eth_sign',
      'eth_signTransaction',
      'eth_signTypedData',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4',
      'personal_sign',
      'personal_sendTransaction',
      'personal_unlockAccount',
      'personal_newAccount',
      'personal_lockAccount',
      // Filter management (stateful)
      'eth_newFilter',
      'eth_newBlockFilter',
      'eth_newPendingTransactionFilter',
      'eth_uninstallFilter',
      'eth_getFilterChanges',
      // Mining submission
      'eth_submitWork',
      'eth_submitHashrate',
      // Pending transactions
      'eth_pendingTransactions',
      // Transaction pool
      'txpool_content',
      'txpool_inspect',
      'txpool_status'
    ],
    getTTL: (method, params) => {
      return 0; // Never cache
    }
  }
};

/**
 * Get caching configuration for a specific method
 */
export function getMethodCacheConfig(method) {
  for (const [category, config] of Object.entries(METHOD_CACHE_RULES)) {
    if (config.methods.includes(method)) {
      return {
        category,
        ...config
      };
    }
  }
  
  // Default: allow unknown methods but with short TTL
  return {
    category: 'unknown',
    getTTL: () => 10 // 10 seconds default for unknown methods
  };
}

/**
 * Check if a method should be cached
 */
export function shouldCacheMethod(method, params) {
  const config = getMethodCacheConfig(method);
  
  // Never cache if in neverCache category
  if (config.category === 'neverCache') {
    return false;
  }
  
  // Check TTL - if 0, don't cache
  const ttl = config.getTTL(method, params);
  return ttl !== 0;
}

/**
 * Get TTL for a specific method and params
 */
export function getMethodTTL(method, params) {
  const config = getMethodCacheConfig(method);
  return config.getTTL(method, params);
}

/**
 * Generate cache key for any method
 */
export function generateMethodCacheKey(method, params) {
  // Create a deterministic key based on method and params
  const paramsStr = JSON.stringify(params || []);
  return `${method}:${paramsStr}`;
}

// Export for use in other modules
export default {
  METHOD_CACHE_RULES,
  getMethodCacheConfig,
  shouldCacheMethod,
  getMethodTTL,
  generateMethodCacheKey
};