#!/usr/bin/env node

/**
 * Test script for multi-URL fallback feature
 *
 * Usage:
 *   # Test with multiple URLs (one invalid to trigger fallback)
 *   UPSTREAM_RPC_URL="http://invalid.url,https://eth.llamarpc.com" REDIS_URL=memory node tests/test-multi-url.js
 *
 *   # Test with single URL (backward compatibility)
 *   UPSTREAM_RPC_URL="https://eth.llamarpc.com" REDIS_URL=memory node tests/test-multi-url.js
 */

import axios from 'axios';
import { spawn } from 'child_process';

const PORT = process.env.PORT || 3333;
const SERVER_URL = `http://localhost:${PORT}`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${msg}${colors.reset}`),
  json: (obj) => console.log(JSON.stringify(obj, null, 2))
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
  log.header('Starting RPC Proxy Server...');

  const env = {
    ...process.env,
    PORT: PORT.toString(),
    NODE_ENV: 'test'
  };

  const server = spawn('node', ['src/index.js'], {
    env,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  let serverReady = false;

  server.stdout.on('data', (data) => {
    const output = data.toString();
    if (output.includes('Server Started')) {
      serverReady = true;
    }
    if (process.env.SHOW_SERVER_LOGS) {
      console.log('Server:', output);
    }
  });

  server.stderr.on('data', (data) => {
    if (process.env.SHOW_SERVER_LOGS) {
      console.error('Server Error:', data.toString());
    }
  });

  // Wait for server to start
  for (let i = 0; i < 30; i++) {
    if (serverReady) break;
    await sleep(200);
  }

  if (!serverReady) {
    throw new Error('Server failed to start');
  }

  log.success('Server started successfully');
  return server;
}

async function testHealth() {
  log.header('Testing Health Endpoint...');

  try {
    const response = await axios.get(`${SERVER_URL}/health`);
    const data = response.data;

    log.success('Health check successful');
    log.info(`RPC Providers: ${data.rpcProviders.length}`);

    data.rpcProviders.forEach((provider, index) => {
      const status = provider.healthy ? '🟢' : '🔴';
      log.info(`  ${index + 1}. ${status} ${provider.url}`);
    });

    return data;
  } catch (error) {
    log.error(`Health check failed: ${error.message}`);
    throw error;
  }
}

async function testRpcCall(method = 'eth_blockNumber', params = []) {
  log.header(`Testing RPC Call: ${method}...`);

  try {
    const response = await axios.post(SERVER_URL, {
      jsonrpc: '2.0',
      method,
      params,
      id: 1
    });

    const data = response.data;
    log.success(`RPC call successful (cached: ${data.cached})`);
    log.info(`Result: ${JSON.stringify(data.result)}`);

    return data;
  } catch (error) {
    log.error(`RPC call failed: ${error.message}`);
    if (error.response) {
      log.json(error.response.data);
    }
    throw error;
  }
}

async function testFallback() {
  log.header('Testing Fallback Behavior...');

  // Check if multiple URLs are configured
  const health = await testHealth();

  if (health.rpcProviders.length === 1) {
    log.info('Only one RPC URL configured - fallback not applicable');
    return;
  }

  log.info('Multiple URLs detected - fallback is enabled');

  // Make several calls to potentially trigger fallback
  for (let i = 0; i < 3; i++) {
    log.info(`\nAttempt ${i + 1}:`);
    await testRpcCall('eth_blockNumber');
    await sleep(1000);
  }

  // Check health again to see if any URLs were marked unhealthy
  const healthAfter = await testHealth();

  const unhealthyCount = healthAfter.rpcProviders.filter(p => !p.healthy).length;
  if (unhealthyCount > 0) {
    log.info(`${unhealthyCount} URL(s) marked as unhealthy during testing`);
  }
}

async function runTests() {
  let server;

  try {
    // Display configuration
    log.header('Configuration:');
    const urls = process.env.UPSTREAM_RPC_URL || 'Not set';
    log.info(`UPSTREAM_RPC_URL: ${urls}`);

    if (urls.includes(',')) {
      const urlList = urls.split(',').map(u => u.trim());
      log.success(`Multi-URL mode detected: ${urlList.length} URLs`);
      urlList.forEach((url, i) => log.info(`  ${i + 1}. ${url}`));
    } else {
      log.info('Single URL mode');
    }

    // Start server
    server = await startServer();
    await sleep(2000); // Give server time to fully initialize

    // Run tests
    await testHealth();
    await testRpcCall('eth_blockNumber');
    await testRpcCall('eth_chainId');
    await testFallback();

    log.header('✅ All tests completed successfully!');

  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (server) {
      log.info('Shutting down server...');
      server.kill('SIGTERM');
      await sleep(1000);
    }
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});