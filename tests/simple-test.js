#!/usr/bin/env node

// Simple test runner to verify the core functionality works
import { RequestCoalescer } from '../src/cache/requestCoalescer.js';
import { CircuitBreaker } from '../src/utils/circuitBreaker.js';
import { config } from '../src/config/index.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

console.log('🧪 Running Simple Tests for Ethereum RPC Cache Proxy\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Test RequestCoalescer
console.log('📦 Testing RequestCoalescer');
console.log('================================\n');

await test('RequestCoalescer: Should coalesce duplicate requests', async () => {
  const coalescer = new RequestCoalescer();
  let callCount = 0;
  
  const fetchFn = async () => {
    callCount++;
    await sleep(50);
    return 'result';
  };
  
  // Start 5 concurrent requests for the same key
  const promises = [
    coalescer.getOrFetch('key1', fetchFn),
    coalescer.getOrFetch('key1', fetchFn),
    coalescer.getOrFetch('key1', fetchFn),
    coalescer.getOrFetch('key1', fetchFn),
    coalescer.getOrFetch('key1', fetchFn)
  ];
  
  const results = await Promise.all(promises);
  
  // All should get the same result
  assert(results.every(r => r === 'result'), 'All results should be "result"');
  
  // But fetch should only be called once
  assert(callCount === 1, `Fetch should be called once, but was called ${callCount} times`);
  
  // Check metrics
  const metrics = coalescer.getMetrics();
  assert(metrics.totalCoalesced === 4, `Should have 4 coalesced requests, got ${metrics.totalCoalesced}`);
});

await test('RequestCoalescer: Should handle different keys independently', async () => {
  const coalescer = new RequestCoalescer();
  let calls = { key1: 0, key2: 0 };
  
  const fetchFn1 = async () => {
    calls.key1++;
    return 'result1';
  };
  
  const fetchFn2 = async () => {
    calls.key2++;
    return 'result2';
  };
  
  const [result1, result2] = await Promise.all([
    coalescer.getOrFetch('key1', fetchFn1),
    coalescer.getOrFetch('key2', fetchFn2)
  ]);
  
  assert(result1 === 'result1', 'Result1 should be "result1"');
  assert(result2 === 'result2', 'Result2 should be "result2"');
  assert(calls.key1 === 1, 'Key1 should be fetched once');
  assert(calls.key2 === 1, 'Key2 should be fetched once');
});

await test('RequestCoalescer: Should propagate errors to all waiting requests', async () => {
  const coalescer = new RequestCoalescer();
  let callCount = 0;
  
  const fetchFn = async () => {
    callCount++;
    await sleep(50);
    throw new Error('Fetch failed');
  };
  
  const promises = [
    coalescer.getOrFetch('key1', fetchFn).catch(e => e.message),
    coalescer.getOrFetch('key1', fetchFn).catch(e => e.message),
    coalescer.getOrFetch('key1', fetchFn).catch(e => e.message)
  ];
  
  const results = await Promise.all(promises);
  
  assert(results.every(r => r === 'Fetch failed'), 'All should receive the same error');
  assert(callCount === 1, 'Fetch should only be called once even on error');
});

// Test CircuitBreaker
console.log('\n⚡ Testing CircuitBreaker');
console.log('================================\n');

await test('CircuitBreaker: Should open after failure threshold', async () => {
  const breaker = new CircuitBreaker('test', {
    failureThreshold: 3,
    resetTimeout: 1000
  });
  
  let callCount = 0;
  const failingFn = async () => {
    callCount++;
    throw new Error('fail');
  };
  
  // Fail 3 times
  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(failingFn);
    } catch (e) {
      // Expected
    }
  }
  
  assert(breaker.getState() === 'OPEN', 'Circuit should be OPEN');
  assert(callCount === 3, 'Should have called function 3 times');
  
  // Next request should fail immediately
  try {
    await breaker.execute(failingFn);
    assert(false, 'Should have thrown immediately');
  } catch (e) {
    assert(e.message.includes('Circuit breaker is OPEN'), 'Should fail with circuit open error');
  }
  
  assert(callCount === 3, 'Should not call function when circuit is open');
});

await test('CircuitBreaker: Should transition to HALF_OPEN and recover', async () => {
  const breaker = new CircuitBreaker('test', {
    failureThreshold: 2,
    successThreshold: 2,
    resetTimeout: 100
  });
  
  // Open the circuit
  const failFn = async () => { throw new Error('fail'); };
  for (let i = 0; i < 2; i++) {
    try { await breaker.execute(failFn); } catch (e) {}
  }
  
  assert(breaker.getState() === 'OPEN', 'Circuit should be OPEN');
  
  // Wait for reset timeout
  await sleep(150);
  
  // Should allow a test request (HALF_OPEN)
  const successFn = async () => 'success';
  const result1 = await breaker.execute(successFn);
  assert(result1 === 'success', 'Should execute in HALF_OPEN');
  assert(breaker.getState() === 'HALF_OPEN', 'Should be HALF_OPEN');
  
  // Second success should close the circuit
  const result2 = await breaker.execute(successFn);
  assert(result2 === 'success', 'Should execute second time');
  assert(breaker.getState() === 'CLOSED', 'Should be CLOSED after success threshold');
});

// Test Integration Scenario
console.log('\n🔗 Testing Integration Scenario');
console.log('================================\n');

await test('Integration: Should handle 10 concurrent requests with 1 upstream call', async () => {
  const coalescer = new RequestCoalescer();
  const breaker = new CircuitBreaker('integration', {
    failureThreshold: 5,
    resetTimeout: 1000
  });
  
  let upstreamCalls = 0;
  
  const fetchFromUpstream = async () => {
    return await breaker.execute(async () => {
      upstreamCalls++;
      await sleep(100); // Simulate network delay
      return { blockNumber: '0x123456' };
    });
  };
  
  // Simulate 10 nodes making the same request
  const requests = Array(10).fill(null).map(() => 
    coalescer.getOrFetch('eth_blockNumber', fetchFromUpstream)
  );
  
  const results = await Promise.all(requests);
  
  // All should get the same result
  assert(results.every(r => r.blockNumber === '0x123456'), 'All should get same result');
  
  // But only 1 upstream call should be made
  assert(upstreamCalls === 1, `Should make 1 upstream call, made ${upstreamCalls}`);
  
  // Check coalescing metrics
  const metrics = coalescer.getMetrics();
  assert(metrics.totalCoalesced === 9, `Should have 9 coalesced requests, got ${metrics.totalCoalesced}`);
  
  console.log(`   📊 10 requests → ${upstreamCalls} upstream call (90% reduction!)`);
});

await test('Integration: Should handle failures gracefully', async () => {
  const coalescer = new RequestCoalescer();
  const breaker = new CircuitBreaker('integration-fail', {
    failureThreshold: 3,
    resetTimeout: 1000
  });
  
  let attemptCount = 0;
  
  const fetchFromUpstream = async () => {
    return await breaker.execute(async () => {
      attemptCount++;
      if (attemptCount <= 3) {
        throw new Error('Upstream error');
      }
      return { blockNumber: '0x123456' };
    });
  };
  
  // First batch should fail
  const failRequests = Array(5).fill(null).map(() => 
    coalescer.getOrFetch('fail-key', fetchFromUpstream).catch(e => e.message)
  );
  
  const failResults = await Promise.all(failRequests);
  
  assert(failResults.every(r => r === 'Upstream error'), 'All should receive error');
  assert(attemptCount === 1, 'Should only try once for coalesced requests');
  
  // Circuit should now be counting failures
  assert(breaker.failures === 1, 'Should have 1 failure recorded');
});

// Summary
console.log('\n📊 Test Summary');
console.log('================================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed. Please review the errors above.');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed! The concurrent request handling works perfectly.');
  console.log('✨ Your cache stampede problem is solved!');
  process.exit(0);
}