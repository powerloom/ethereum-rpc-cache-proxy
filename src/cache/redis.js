import { createClient } from 'redis';
import { config } from '../config/index.js';

let client = null;

export async function connectRedis() {
  if (client) {
    return client;
  }

  // Return null if Redis is not configured
  if (!config.redis.url || config.redis.url === 'memory') {
    return null;
  }

  try {
    client = createClient({
      url: config.redis.url
    });

    client.on('error', (err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Redis Client Error:', err);
      }
    });

    client.on('connect', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('Redis client connected');
      }
    });

    client.on('ready', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('Redis client ready');
      }
    });

    await client.connect();
    return client;
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to connect to Redis:', error.message);
    }
    client = null;
    return null;
  }
}

export async function disconnectRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}

export function getRedisClient() {
  if (!client) {
    // Return null instead of throwing if Redis is not available
    if (!config.redis.url || config.redis.url === 'memory') {
      return null;
    }
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return client;
}