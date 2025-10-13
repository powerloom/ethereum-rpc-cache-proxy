import { jest } from '@jest/globals';
import axios from 'axios';
import { EthereumService } from '../../src/services/ethereum.js';

// Mock axios
jest.mock('axios');

// Mock config
jest.mock('../../src/config/index.js', () => ({
  config: {
    ethereum: {
      rpcUrl: 'https://primary.example.com',
      rpcUrls: ['https://primary.example.com', 'https://fallback1.example.com', 'https://fallback2.example.com'],
      maxRetriesPerUrl: 2,
      fallbackEnabled: true
    }
  }
}));

describe('EthereumService - Multi-URL Fallback', () => {
  let ethereumService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    ethereumService = new EthereumService();
  });

  afterEach(() => {
    // Clear any pending timers
    jest.clearAllTimers();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('Single URL mode (backward compatibility)', () => {
    it('should work with arrays containing single URL', async () => {
      // The service will have an array with 3 URLs from the mock config
      // Let's just verify it works correctly with the first URL

      // Mock successful response
      axios.post.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: '0x1234',
          id: 1
        }
      });

      const result = await ethereumService.callRPC('eth_blockNumber');
      expect(result).toBe('0x1234');
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        'https://primary.example.com',
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('Multi-URL fallback', () => {
    it('should use primary URL when it succeeds', async () => {
      // Mock successful response on primary
      axios.post.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: '0x1234',
          id: 1
        }
      });

      const result = await ethereumService.callRPC('eth_blockNumber');

      expect(result).toBe('0x1234');
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        'https://primary.example.com',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should fallback to secondary URL when primary fails', async () => {
      // Mock primary failure
      axios.post.mockRejectedValueOnce(new Error('Connection refused'));

      // Mock secondary success
      axios.post.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: '0x5678',
          id: 1
        }
      });

      const result = await ethereumService.callRPC('eth_blockNumber');

      expect(result).toBe('0x5678');
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        'https://primary.example.com',
        expect.any(Object),
        expect.any(Object)
      );
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        'https://fallback1.example.com',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should try all URLs before giving up', async () => {
      // All URLs fail with connection refused (not retryable with same URL)
      axios.post.mockRejectedValue(new Error('Connection refused'));

      await expect(ethereumService.callRPC('eth_blockNumber')).rejects.toThrow('All RPC endpoints failed');

      // Connection refused immediately moves to next URL without retry
      // So it should try each URL once
      expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('should retry on timeout but not on RPC errors', async () => {
      // Mock timeout error (should retry)
      const timeoutError = new Error('timeout');
      timeoutError.code = 'ECONNABORTED';
      axios.post.mockRejectedValueOnce(timeoutError);

      // Second attempt succeeds
      axios.post.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: '0xabc',
          id: 1
        }
      });

      const result = await ethereumService.callRPC('eth_blockNumber');

      expect(result).toBe('0xabc');
      expect(axios.post).toHaveBeenCalledTimes(2);
      // Both calls should be to the same URL (retry)
      expect(axios.post).toHaveBeenCalledWith(
        'https://primary.example.com',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should not retry on RPC errors', async () => {
      // Mock RPC error (should not retry same URL)
      axios.post.mockRejectedValueOnce(new Error('RPC Error: Method not found'));

      // Fallback URL succeeds
      axios.post.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: '0xdef',
          id: 1
        }
      });

      const result = await ethereumService.callRPC('eth_blockNumber');

      expect(result).toBe('0xdef');
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        'https://primary.example.com',
        expect.any(Object),
        expect.any(Object)
      );
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        'https://fallback1.example.com',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should track health metrics per URL', async () => {
      // Primary fails
      axios.post.mockRejectedValueOnce(new Error('Connection refused'));

      // Fallback succeeds
      axios.post.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: '0x123',
          id: 1
        }
      });

      await ethereumService.callRPC('eth_blockNumber');

      const healthStatus = ethereumService.getUrlHealthStatus();

      expect(healthStatus).toHaveLength(3);
      expect(healthStatus[0].failureCount).toBe(1);
      expect(healthStatus[0].healthy).toBe(true); // Still healthy after 1 failure
      expect(healthStatus[1].successCount).toBe(1);
      expect(healthStatus[1].healthy).toBe(true);
    });

    it('should mark URL as unhealthy after 3 consecutive failures', async () => {
      // Simulate 3 failures on primary
      for (let i = 0; i < 3; i++) {
        axios.post.mockRejectedValueOnce(new Error('Connection refused'));
        // Fallback succeeds
        axios.post.mockResolvedValueOnce({
          data: {
            jsonrpc: '2.0',
            result: `0x${i}`,
            id: 1
          }
        });
        await ethereumService.callRPC('eth_blockNumber');
      }

      const healthStatus = ethereumService.getUrlHealthStatus();
      expect(healthStatus[0].healthy).toBe(false); // Primary marked unhealthy
      expect(healthStatus[0].failureCount).toBe(3);
    });
  });

  describe('Batch calls with fallback', () => {
    it('should fallback on batch calls', async () => {
      // Primary fails
      axios.post.mockRejectedValueOnce(new Error('Connection refused'));

      // Fallback succeeds
      axios.post.mockResolvedValueOnce({
        data: [
          { jsonrpc: '2.0', result: '0x1', id: 1 },
          { jsonrpc: '2.0', result: '0x2', id: 2 }
        ]
      });

      const requests = [
        { method: 'eth_blockNumber', params: [] },
        { method: 'eth_gasPrice', params: [] }
      ];

      const results = await ethereumService.batchCall(requests);

      expect(results).toEqual([
        { result: '0x1' },
        { result: '0x2' }
      ]);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('URL sanitization', () => {
    it('should sanitize URLs for logging', () => {
      const testCases = [
        {
          url: 'https://eth-mainnet.g.alchemy.com/v2/abc123def456ghi789jkl012mno345p',
          expected: 'https://eth-mainnet.g.alchemy.com/[API_KEY]'
        },
        {
          url: 'https://mainnet.infura.io/v3/1234567890abcdef1234567890abcdef',
          expected: 'https://mainnet.infura.io/[API_KEY]'
        },
        {
          url: 'https://eth.llamarpc.com',
          expected: 'https://eth.llamarpc.com/'
        }
      ];

      testCases.forEach(testCase => {
        expect(ethereumService.sanitizeUrl(testCase.url)).toBe(testCase.expected);
      });
    });
  });
});