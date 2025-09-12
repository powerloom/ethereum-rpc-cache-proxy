// Test setup file
import dotenv from 'dotenv';
import { jest } from '@jest/globals';

// Load test environment variables quietly
dotenv.config({ path: '.env.test', quiet: true });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // Suppress all logs during tests

// Ensure required env vars are set for tests
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://localhost:6379';
}
if (!process.env.UPSTREAM_RPC_URL) {
  process.env.UPSTREAM_RPC_URL = 'http://localhost:8545';
}
if (!process.env.PERMANENT_CACHE_HEIGHT) {
  process.env.PERMANENT_CACHE_HEIGHT = '15537393';
}

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Global test utilities available in all tests
global.jest = jest;

// No need to mock redis here - let individual tests handle it