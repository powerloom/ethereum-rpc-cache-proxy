// Integration test setup - mocks Redis before any imports
import { jest } from '@jest/globals';

// Create a working mock store
global.mockRedisStore = new Map();
global.mockStaleStore = new Map();

// Create mock Redis client
global.mockRedisClient = {
  connect: jest.fn().mockResolvedValue(true),
  quit: jest.fn().mockResolvedValue(true),
  on: jest.fn().mockReturnThis(),
  
  get: jest.fn().mockImplementation(async (key) => {
    // Return from appropriate store
    if (key.startsWith('stale:')) {
      return global.mockStaleStore.get(key) || null;
    }
    return global.mockRedisStore.get(key) || null;
  }),
  
  set: jest.fn().mockImplementation(async (key, value, options) => {
    // Store in appropriate store
    if (key.startsWith('stale:')) {
      global.mockStaleStore.set(key, value);
    } else {
      global.mockRedisStore.set(key, value);
    }
    return 'OK';
  }),
  
  setex: jest.fn().mockImplementation(async (key, ttl, value) => {
    global.mockRedisStore.set(key, value);
    return 'OK';
  }),
  
  del: jest.fn().mockImplementation(async (keys) => {
    let count = 0;
    const keysArray = Array.isArray(keys) ? keys : [keys];
    keysArray.forEach(key => {
      if (global.mockRedisStore.delete(key)) count++;
      if (global.mockStaleStore.delete(key)) count++;
    });
    return count;
  }),
  
  exists: jest.fn().mockImplementation(async (key) => {
    return global.mockRedisStore.has(key) || global.mockStaleStore.has(key) ? 1 : 0;
  }),
  
  flushAll: jest.fn().mockImplementation(async () => {
    global.mockRedisStore.clear();
    global.mockStaleStore.clear();
    return 'OK';
  }),
  
  keys: jest.fn().mockImplementation(async (pattern) => {
    const allKeys = [
      ...Array.from(global.mockRedisStore.keys()),
      ...Array.from(global.mockStaleStore.keys())
    ];
    if (pattern === '*') return allKeys;
    const regex = new RegExp(pattern.replace('*', '.*'));
    return allKeys.filter(key => regex.test(key));
  }),
  
  info: jest.fn().mockResolvedValue(''),
  dbSize: jest.fn().mockImplementation(async () => global.mockRedisStore.size),
  
  isOpen: true,
  isReady: true
};

// Mock the redis module before it's imported
jest.mock('../../src/cache/redis.js', () => ({
  connectRedis: jest.fn().mockResolvedValue(global.mockRedisClient),
  getRedisClient: jest.fn().mockReturnValue(global.mockRedisClient),
  disconnectRedis: jest.fn().mockResolvedValue(true)
}));

// Reset stores before each test
beforeEach(() => {
  global.mockRedisStore.clear();
  global.mockStaleStore.clear();
});