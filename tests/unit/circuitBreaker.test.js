import { jest } from '@jest/globals';
import { CircuitBreaker } from '../../src/utils/circuitBreaker.js';

describe('CircuitBreaker', () => {
  let breaker;
  
  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      resetTimeout: 1000,
      volumeThreshold: 5,
      errorThresholdPercentage: 50
    });
  });

  describe('execute', () => {
    it('should execute function successfully when circuit is closed', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await breaker.execute(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open circuit after failure threshold', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('fail');
      }
      
      expect(breaker.getState()).toBe('OPEN');
      expect(fn).toHaveBeenCalledTimes(3);
      
      // Next request should be rejected immediately
      await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is OPEN');
      expect(fn).toHaveBeenCalledTimes(3); // Not called again
    });

    it('should transition to half-open after reset timeout', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('fail');
      }
      
      expect(breaker.getState()).toBe('OPEN');
      
      // Wait for reset timeout
      await global.sleep(1100);
      
      // Should allow one request (half-open)
      const result = await breaker.execute(fn);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('HALF_OPEN');
    });

    it('should close circuit after success threshold in half-open', async () => {
      // Open the circuit first
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failFn)).rejects.toThrow('fail');
      }
      
      // Force to half-open
      breaker.attemptReset();
      expect(breaker.getState()).toBe('HALF_OPEN');
      
      // Succeed twice (success threshold)
      const successFn = jest.fn().mockResolvedValue('success');
      await breaker.execute(successFn);
      await breaker.execute(successFn);
      
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should re-open circuit on failure in half-open', async () => {
      // Open the circuit
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failFn)).rejects.toThrow('fail');
      }
      
      // Force to half-open
      breaker.attemptReset();
      expect(breaker.getState()).toBe('HALF_OPEN');
      
      // Fail again
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
      
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should timeout long-running functions', async () => {
      const slowFn = jest.fn().mockImplementation(async () => {
        await global.sleep(200); // Longer than timeout
        return 'result';
      });
      
      await expect(breaker.execute(slowFn)).rejects.toThrow('Circuit breaker timeout');
      expect(breaker.failures).toBe(1);
    });

    it('should use percentage-based threshold with volume', async () => {
      const fn = jest.fn()
        .mockResolvedValueOnce('success')
        .mockResolvedValueOnce('success')
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');
      
      // Execute 6 requests (above volume threshold of 5)
      await breaker.execute(fn); // success
      await breaker.execute(fn); // success
      await expect(breaker.execute(fn)).rejects.toThrow(); // fail
      await expect(breaker.execute(fn)).rejects.toThrow(); // fail
      await expect(breaker.execute(fn)).rejects.toThrow(); // fail
      
      // 3 failures out of 5 = 60% > 50% threshold
      // But also hits the simple failure threshold of 3
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('state management', () => {
    it('should allow manual trip', () => {
      expect(breaker.getState()).toBe('CLOSED');
      breaker.trip();
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should allow manual reset', () => {
      breaker.trip();
      expect(breaker.getState()).toBe('OPEN');
      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should check if requests are allowed', () => {
      expect(breaker.isAllowed()).toBe(true);
      
      breaker.trip();
      expect(breaker.isAllowed()).toBe(false);
      
      breaker.reset();
      expect(breaker.isAllowed()).toBe(true);
    });

    it('should call state change callback', async () => {
      const onStateChange = jest.fn();
      const customBreaker = new CircuitBreaker('custom', {
        failureThreshold: 1,
        onStateChange
      });
      
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      await customBreaker.execute(failFn).catch(() => {});
      
      expect(onStateChange).toHaveBeenCalledWith('CLOSED', 'OPEN', 'custom');
    });
  });

  describe('metrics', () => {
    it('should track metrics correctly', async () => {
      const fn = jest.fn()
        .mockResolvedValueOnce('success')
        .mockRejectedValueOnce(new Error('fail'));
      
      await breaker.execute(fn);
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalSuccesses).toBe(1);
      expect(metrics.totalFailures).toBe(1);
    });

    it('should track rejections when open', async () => {
      // Open the circuit
      breaker.trip();
      
      const fn = jest.fn().mockResolvedValue('success');
      await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is OPEN');
      
      const metrics = breaker.getMetrics();
      expect(metrics.totalRejections).toBe(1);
      expect(fn).not.toHaveBeenCalled();
    });

    it('should calculate rolling window stats', async () => {
      const fn = jest.fn()
        .mockResolvedValueOnce('success')
        .mockResolvedValueOnce('success')
        .mockRejectedValueOnce(new Error('fail'));
      
      await breaker.execute(fn);
      await breaker.execute(fn);
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      const metrics = breaker.getMetrics();
      expect(metrics.rollingWindow.total).toBe(3);
      expect(metrics.rollingWindow.successes).toBe(2);
      expect(metrics.rollingWindow.failures).toBe(1);
      expect(metrics.rollingWindow.successRate).toBeCloseTo(66.67, 1);
    });

    it('should reset metrics', () => {
      breaker.metrics.totalRequests = 10;
      breaker.metrics.totalFailures = 5;
      
      breaker.resetMetrics();
      
      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalFailures).toBe(0);
    });
  });

  describe('rolling window', () => {
    it('should remove old entries from rolling window', async () => {
      // Create breaker with short window
      const shortBreaker = new CircuitBreaker('short', {
        windowSize: 100 // 100ms window
      });
      
      const fn = jest.fn().mockResolvedValue('success');
      
      await shortBreaker.execute(fn);
      expect(shortBreaker.getRollingStats().total).toBe(1);
      
      await global.sleep(150); // Wait for window to expire
      
      await shortBreaker.execute(fn);
      
      // Old entry should be removed
      const stats = shortBreaker.getRollingStats();
      expect(stats.total).toBe(1); // Only recent entry
    });
  });
});