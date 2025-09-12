import { jest } from '@jest/globals';
import { RequestCoalescer } from '../../src/cache/requestCoalescer.js';

describe('RequestCoalescer', () => {
  let coalescer;

  beforeEach(() => {
    coalescer = new RequestCoalescer();
  });

  afterEach(() => {
    coalescer.clearAll();
  });

  describe('getOrFetch', () => {
    it('should fetch data for first request', async () => {
      const fetchFn = jest.fn().mockResolvedValue('result');
      const result = await coalescer.getOrFetch('key1', fetchFn);
      
      expect(result).toBe('result');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should coalesce duplicate concurrent requests', async () => {
      const fetchFn = jest.fn().mockImplementation(async () => {
        await global.sleep(50); // Simulate network delay
        return 'result';
      });

      // Start multiple concurrent requests
      const promises = [
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn)
      ];

      const results = await Promise.all(promises);

      // All should get the same result
      expect(results).toEqual(['result', 'result', 'result', 'result', 'result']);
      
      // But fetch should only be called once
      expect(fetchFn).toHaveBeenCalledTimes(1);
      
      // Check metrics
      expect(coalescer.getMetrics().totalCoalesced).toBe(4); // 4 requests waited
    });

    it('should handle different keys independently', async () => {
      const fetchFn1 = jest.fn().mockResolvedValue('result1');
      const fetchFn2 = jest.fn().mockResolvedValue('result2');

      const [result1, result2] = await Promise.all([
        coalescer.getOrFetch('key1', fetchFn1),
        coalescer.getOrFetch('key2', fetchFn2)
      ]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(fetchFn1).toHaveBeenCalledTimes(1);
      expect(fetchFn2).toHaveBeenCalledTimes(1);
    });

    it('should handle fetch failures', async () => {
      const error = new Error('Fetch failed');
      const fetchFn = jest.fn().mockRejectedValue(error);

      await expect(coalescer.getOrFetch('key1', fetchFn)).rejects.toThrow('Fetch failed');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(coalescer.getMetrics().failures).toBe(1);
    });

    it('should propagate errors to all waiting requests', async () => {
      const error = new Error('Fetch failed');
      const fetchFn = jest.fn().mockImplementation(async () => {
        await global.sleep(50);
        throw error;
      });

      const promises = [
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn)
      ];

      // All should receive the same error
      await expect(Promise.all(promises)).rejects.toThrow('Fetch failed');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should timeout long-running requests', async () => {
      // Create coalescer with short timeout
      const shortCoalescer = new RequestCoalescer();
      shortCoalescer.timeout = 100; // 100ms timeout

      const fetchFn = jest.fn().mockImplementation(async () => {
        await global.sleep(200); // Longer than timeout
        return 'result';
      });

      await expect(shortCoalescer.getOrFetch('key1', fetchFn))
        .rejects.toThrow('Request timeout');
      
      expect(shortCoalescer.getMetrics().timeouts).toBe(1);
    });

    it('should clean up after completion', async () => {
      const fetchFn = jest.fn().mockResolvedValue('result');
      
      await coalescer.getOrFetch('key1', fetchFn);
      
      expect(coalescer.isInFlight('key1')).toBe(false);
      expect(coalescer.getInFlightCount()).toBe(0);
    });

    it('should respect enabled flag', async () => {
      coalescer.enabled = false;
      
      const fetchFn = jest.fn().mockResolvedValue('result');
      
      // Multiple calls should all trigger fetch when disabled
      const promises = [
        coalescer.getOrFetch('key1', fetchFn),
        coalescer.getOrFetch('key1', fetchFn)
      ];

      await Promise.all(promises);
      
      expect(fetchFn).toHaveBeenCalledTimes(2); // No coalescing
      expect(coalescer.getMetrics().totalCoalesced).toBe(0);
    });
  });

  describe('metrics', () => {
    it('should track metrics correctly', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('result2');

      await coalescer.getOrFetch('key1', fetchFn);
      await expect(coalescer.getOrFetch('key2', fetchFn)).rejects.toThrow();
      await coalescer.getOrFetch('key3', fetchFn);

      const metrics = coalescer.getMetrics();
      expect(metrics.failures).toBe(1);
      expect(metrics.currentInFlight).toBe(0);
    });

    it('should reset metrics', () => {
      coalescer.metrics.totalCoalesced = 10;
      coalescer.metrics.failures = 5;
      
      coalescer.resetMetrics();
      
      const metrics = coalescer.getMetrics();
      expect(metrics.totalCoalesced).toBe(0);
      expect(metrics.failures).toBe(0);
    });
  });

  describe('cleanup methods', () => {
    it('should force cleanup specific key', async () => {
      const fetchFn = jest.fn().mockImplementation(async () => {
        await global.sleep(100);
        return 'result';
      });

      // Start request but don't wait
      coalescer.getOrFetch('key1', fetchFn);
      
      expect(coalescer.isInFlight('key1')).toBe(true);
      
      coalescer.forceCleanup('key1');
      
      expect(coalescer.isInFlight('key1')).toBe(false);
    });

    it('should clear all in-flight requests', async () => {
      const fetchFn = jest.fn().mockImplementation(async () => {
        await global.sleep(100);
        return 'result';
      });

      // Start multiple requests
      coalescer.getOrFetch('key1', fetchFn);
      coalescer.getOrFetch('key2', fetchFn);
      
      expect(coalescer.getInFlightCount()).toBe(2);
      
      coalescer.clearAll();
      
      expect(coalescer.getInFlightCount()).toBe(0);
    });
  });
});