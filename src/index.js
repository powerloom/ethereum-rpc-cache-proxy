import { buildServer } from './server.js';
import { config } from './config/index.js';

async function start() {
  try {
    const server = await buildServer();
    
    await server.listen({
      port: config.server.port,
      host: config.server.host
    });

    console.log(`
🚀 Ethereum RPC Cache Proxy Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server: http://${config.server.host}:${config.server.port}
🔗 Upstream RPC: ${config.ethereum.rpcUrl.substring(0, 30)}...
💾 Cache: ${config.redis.url || 'in-memory'}
🔒 Permanent Cache Height: ${config.cache.permanentCacheHeight}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Available endpoints:
  POST /              - JSON-RPC endpoint
  GET  /health        - Health check and metrics
  GET  /cache/stats   - Cache statistics
  POST /cache/flush   - Clear cache (testing)

Supported RPC methods:
  ✅ ALL 45+ Ethereum JSON-RPC methods supported!
  
  📊 Intelligent caching by category:
    • Immutable data (tx receipts, old blocks) - Permanent cache
    • Block data (latest, recent) - TTL: ${config.cache.latestBlockTtl}s to ${config.cache.recentBlockTtl}s
    • Account state (balances, nonce) - TTL: 15s
    • Gas prices (eth_gasPrice) - TTL: 5s  
    • Network info (chainId, version) - TTL: 1h
    • Contract calls (eth_call) - TTL: ${config.cache.ethCallTtl}s
    • Write operations - Never cached
  
  See /config/methodCaching.js for full method list
    `);

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();