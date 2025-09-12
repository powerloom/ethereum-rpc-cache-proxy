import axios from 'axios';
import { config } from '../config/index.js';

export class EthereumService {
  constructor() {
    this.rpcUrl = config.ethereum.rpcUrl;
    this.requestId = 0;
  }

  // Make JSON-RPC call to upstream Ethereum node
  async callRPC(method, params = []) {
    const requestId = ++this.requestId;
    
    try {
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: requestId
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        if (process.env.NODE_ENV !== 'test') {
          console.error('Ethereum RPC error response:', error.response.data);
        }
        throw new Error(`Ethereum RPC failed: ${error.response.data.error?.message || error.message}`);
      } else if (error.request) {
        // The request was made but no response was received
        if (process.env.NODE_ENV !== 'test') {
          console.error('Ethereum RPC no response:', error.message);
        }
        throw new Error(`Ethereum RPC timeout: ${error.message}`);
      } else {
        // Something happened in setting up the request that triggered an Error
        if (process.env.NODE_ENV !== 'test') {
          console.error('Ethereum RPC request setup error:', error.message);
        }
        throw error;
      }
    }
  }

  // Get latest block number
  async getBlockNumber() {
    const result = await this.callRPC('eth_blockNumber');
    return result;
  }

  // Get block by number
  async getBlockByNumber(blockNumber, includeTransactions = false) {
    const result = await this.callRPC('eth_getBlockByNumber', [blockNumber, includeTransactions]);
    return result;
  }

  // Execute eth_call
  async ethCall(callData, blockTag = 'latest') {
    const result = await this.callRPC('eth_call', [callData, blockTag]);
    return result;
  }

  // Batch RPC calls
  async batchCall(requests) {
    const batchRequests = requests.map((req, index) => ({
      jsonrpc: '2.0',
      method: req.method,
      params: req.params || [],
      id: index + 1
    }));

    try {
      const response = await axios.post(this.rpcUrl, batchRequests, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      // Map responses back to match request order
      const responseMap = {};
      response.data.forEach(res => {
        responseMap[res.id] = res;
      });

      return requests.map((req, index) => {
        const res = responseMap[index + 1];
        if (res.error) {
          return { error: res.error };
        }
        return { result: res.result };
      });
    } catch (error) {
      console.error('Batch RPC error:', error);
      throw error;
    }
  }
}