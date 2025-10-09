import Fastify from 'fastify';
import { config } from './config/index.js';
import { connectRedis, disconnectRedis } from './cache/redis.js';
import { RPCHandler } from './handlers/rpcHandler.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.logging.level,
      ...(config.logging.prettyPrint && {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      })
    }
  });

  // Initialize RPC handler (will handle cache initialization)
  const rpcHandler = new RPCHandler();
  await rpcHandler.initialize();

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    const metrics = rpcHandler.getMetrics();
    const cacheType = rpcHandler.cacheManager.getCacheType();
    const rpcProviders = rpcHandler.ethereumService.getUrlHealthStatus();

    return {
      status: 'healthy',
      uptime: process.uptime(),
      cacheType,
      metrics,
      rpcProviders,
      config: {
        permanentCacheHeight: config.cache.permanentCacheHeight,
        ethCallTtl: config.cache.ethCallTtl,
        rpcUrlCount: rpcProviders.length,
        fallbackEnabled: config.ethereum.fallbackEnabled
      }
    };
  });

  // Cache stats endpoint
  fastify.get('/cache/stats', async (request, reply) => {
    const stats = await rpcHandler.cacheManager.getStats();
    const metrics = rpcHandler.getMetrics();
    
    return {
      cache: stats,
      metrics
    };
  });

  // Clear cache endpoint (useful for testing)
  fastify.post('/cache/flush', async (request, reply) => {
    const result = await rpcHandler.cacheManager.flush();
    rpcHandler.resetMetrics();
    
    return {
      success: result,
      message: result ? 'Cache flushed successfully' : 'Failed to flush cache'
    };
  });

  // Main JSON-RPC endpoint
  fastify.post('/', async (request, reply) => {
    const body = request.body;

    // Handle batch requests
    if (Array.isArray(body)) {
      const response = await rpcHandler.handleBatchRequest(body);
      return response;
    }

    // Handle single request
    const response = await rpcHandler.handleRequest(body);
    return response;
  });

  // Graceful shutdown
  const closeHandler = async () => {
    console.log('Shutting down server...');
    await disconnectRedis();
    await fastify.close();
    console.log('Server shut down gracefully');
  };

  process.on('SIGINT', closeHandler);
  process.on('SIGTERM', closeHandler);

  return fastify;
}