# Ethereum RPC Cache Proxy

A high-performance Node.js caching service for ALL Ethereum JSON-RPC methods with intelligent caching strategies. Supports both Redis and in-memory caching backends. Built with Fastify for speed and optimized to solve the cache stampede problem. The proxy intelligently caches 45+ RPC methods based on their data characteristics, from permanent caching for immutable data to no caching for write operations.

## 🚀 Key Highlights

- **ALL Ethereum RPC methods supported** with intelligent caching strategies
- **90% reduction in upstream RPC calls** through smart caching
- **Solves cache stampede problem** with request coalescing
- **Multi-URL fallback support**: Automatic failover to backup RPC providers
- **Cache transparency**: Returns `cached` field indicating data source
- **Dual cache backend**: Redis (production) or in-memory (development)
- **Zero Redis dependency**: Run without Redis using in-memory cache
- **Production-ready**: Circuit breakers, distributed locking, metrics
- **Tested with**: LlamaRPC, Alchemy, Infura, and other providers

## 🏃 Quick Start (30 seconds)

### Option 1: Using Docker (Recommended)
```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/powerloom/ethereum-rpc-cache-proxy:latest

# Run with in-memory cache + LlamaRPC
docker run -d -p 3000:3000 \
  -e UPSTREAM_RPC_URL=https://eth.llamarpc.com \
  -e REDIS_URL=memory \
  ghcr.io/powerloom/ethereum-rpc-cache-proxy:latest

# Or use docker-compose
docker compose -f docker-compose.memory.yml up

# Test it
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Option 2: Using Node.js
```bash
# Clone and install
git clone https://github.com/powerloom/ethereum-rpc-cache-proxy.git
cd ethereum-rpc-cache-proxy && npm install

# Run with in-memory cache and free LlamaRPC (no config needed!)
UPSTREAM_RPC_URL=https://eth.llamarpc.com REDIS_URL=memory npm run dev

# Test it
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

That's it! The proxy is now running with in-memory cache and connected to LlamaRPC.

## Features

### Core Features
- **Comprehensive Method Support**: Caches ALL Ethereum RPC methods intelligently
- **Multi-URL Fallback**: Automatic failover to backup RPC providers (comma-separated URLs)
- **Smart Caching by Category**:
  - Permanent caching for immutable data (transactions, receipts)
  - Dynamic TTLs for state data (balances, gas prices)
  - No caching for write operations (send transactions, signing)
- **Automatic Method Detection**: New RPC methods are automatically handled
- **Batch Request Support**: Handle multiple JSON-RPC requests in a single call
- **Metrics & Monitoring**: Built-in health checks and cache statistics with per-URL tracking
- **High Performance**: Built on Fastify framework

### Advanced Features (All Optional)
- **Request Coalescing**: Prevents cache stampede by combining duplicate concurrent requests
- **Distributed Locking**: Redis-based locks for multi-instance deployments
- **Circuit Breaker**: Protects upstream RPC from cascading failures
- **Stale-While-Revalidate**: Serve stale data immediately while refreshing in background
- **Negative Caching**: Cache failures to prevent repeated upstream errors
- **Enhanced Metrics**: Track coalescing, circuit breaker state, lock contentions

## Supported RPC Methods

**ALL 45+ Ethereum JSON-RPC methods are supported!** Methods are intelligently cached based on their data characteristics:

### Cached Methods (by category)

**Permanently Cached (Immutable Data)**
- `eth_getTransactionByHash`, `eth_getTransactionReceipt`
- `eth_getBlockByHash`, `eth_getTransactionByBlockHashAndIndex`

**Smart TTL (Based on Block Height)**
- `eth_blockNumber` (2s), `eth_getBlockByNumber` (varies)
- `eth_getBlockTransactionCountByHash/Number`

**Short TTL (Dynamic Data)**
- `eth_getBalance` (15s), `eth_getTransactionCount` (15s)
- `eth_gasPrice` (5s), `eth_estimateGas` (5s)
- `eth_call` (30s-permanent based on block)

**Long TTL (Rarely Changes)**
- `eth_chainId` (1h), `net_version` (1h)
- `eth_protocolVersion`, `web3_clientVersion`

### Never Cached (Write Operations)
- `eth_sendTransaction`, `eth_sendRawTransaction`
- All signing methods (`eth_sign`, `eth_signTypedData`, etc.)
- Filter management methods
- Transaction pool queries

## Response Format

All successful responses include a `cached` field indicating whether the data was served from cache:

```json
{
  "jsonrpc": "2.0",
  "result": "0x16433f9",
  "id": 1,
  "cached": false  // false = fetched from upstream, true = served from cache
}
```

## Prerequisites

- Node.js 18+ 
- Redis server (optional - will use in-memory cache if not available)
- Ethereum RPC endpoint (Alchemy, Infura, etc.)

## Docker Images

Official Docker images are available on GitHub Container Registry:

```bash
# Latest stable version
docker pull ghcr.io/powerloom/ethereum-rpc-cache-proxy:latest

# Specific version
docker pull ghcr.io/powerloom/ethereum-rpc-cache-proxy:v0.1.0

# Development version
docker pull ghcr.io/powerloom/ethereum-rpc-cache-proxy:develop
```

### Available Tags
- `latest` - Latest stable release (only updated on version releases)
- `master` - Latest commit from master branch
- `develop` - Latest commit from develop branch
- `v*.*.*` - Specific version tags (e.g., v0.1.0, v1.0.0)
- `pr-*` - Pull request builds (e.g., pr-123)

## Installation

```bash
# Clone the repository
git clone https://github.com/powerloom/ethereum-rpc-cache-proxy.git
cd ethereum-rpc-cache-proxy

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

Edit the `.env` file with your settings:

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Upstream Ethereum RPC
# Single URL:
UPSTREAM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key
# Multiple URLs with automatic fallback (comma-separated):
# UPSTREAM_RPC_URL=https://eth.llamarpc.com,https://mainnet.infura.io/v3/key,https://eth-mainnet.g.alchemy.com/v2/key

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Cache Configuration
PERMANENT_CACHE_HEIGHT=15537393
LATEST_BLOCK_TTL=2
ETH_CALL_TTL=300
RECENT_BLOCK_TTL=60
```

### Configuration Options

#### Cache Backend
- **REDIS_URL**: Redis connection string or 'memory' for in-memory cache
- **CACHE_TYPE**: Force cache type ('auto', 'redis', or 'memory')

#### Cache Settings
- **PERMANENT_CACHE_HEIGHT**: Blocks up to this height are cached permanently
- **LATEST_BLOCK_TTL**: TTL for eth_blockNumber cache (seconds)
- **ETH_CALL_TTL**: TTL for ALL eth_call results (seconds) - applies to all contracts
- **RECENT_BLOCK_TTL**: TTL for recent blocks above permanent height (seconds)

## Multi-URL Fallback Support (New Feature!)

The proxy now supports **automatic fallback** to backup RPC URLs when the primary fails. Simply provide comma-separated URLs in `UPSTREAM_RPC_URL`.

### How It Works
1. **Auto-detection**: The proxy automatically detects multiple URLs when comma-separated
2. **Intelligent retry**: On failure, automatically tries the next URL in the list
3. **Health tracking**: Failed URLs are temporarily marked unhealthy (re-enabled after 1 minute)
4. **Transparent operation**: Works seamlessly with existing single-URL configurations

### Configuration Examples

```env
# Single URL (traditional mode - no changes needed)
UPSTREAM_RPC_URL=https://eth.llamarpc.com

# Multiple URLs with automatic fallback
UPSTREAM_RPC_URL=https://eth.llamarpc.com,https://mainnet.infura.io/v3/key,https://eth-mainnet.g.alchemy.com/v2/key

# Mix free and paid providers (free as primary, paid as fallback)
UPSTREAM_RPC_URL=https://eth.llamarpc.com,https://eth-mainnet.g.alchemy.com/v2/your-key

# Configure fallback behavior (optional)
RPC_FALLBACK_ENABLED=true      # Enable/disable fallback (default: true)
RPC_MAX_RETRIES_PER_URL=2      # Retries per URL before moving to next (default: 2)
```

### Benefits
- **High availability**: Never go down due to a single RPC provider failure
- **Cost optimization**: Use free providers as primary, paid as backup
- **Load distribution**: Spread load across multiple providers
- **Zero downtime migration**: Switch providers without service interruption

### Health Monitoring

The `/health` endpoint shows all configured RPC providers and their status:

```json
{
  "rpcProviders": [
    {
      "url": "https://eth.llamarpc.com/",
      "healthy": true,
      "failureCount": 0,
      "successCount": 150,
      "lastError": null
    },
    {
      "url": "https://mainnet.infura.io/[API_KEY]",
      "healthy": false,
      "failureCount": 3,
      "lastError": "timeout",
      "lastErrorTime": 1704156789000
    }
  ]
}
```

## Running the Server

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Running without Redis (in-memory cache)
```bash
# Option 1: Set REDIS_URL to 'memory'
REDIS_URL=memory npm run dev

# Option 2: Leave REDIS_URL empty (auto-detects and falls back to memory)
unset REDIS_URL && npm run dev

# Option 3: Force memory cache via CACHE_TYPE
CACHE_TYPE=memory npm run dev
```

**Note**: In-memory cache is suitable for development and testing but not recommended for production as:
- Cache is lost when server restarts
- No persistence between deployments
- No sharing between multiple instances
- Limited by Node.js process memory

## API Endpoints

### JSON-RPC Endpoint
```bash
POST /
```

Example request:
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }'
```

### Health Check
```bash
GET /health
```

Returns server health status and enhanced metrics:
```json
{
  "status": "healthy",
  "uptime": 123.456,
  "metrics": {
    "cacheHits": 100,
    "cacheMisses": 20,
    "totalRequests": 120,
    "cacheHitRate": "83.33%",
    "coalescedRequests": 45,
    "staleServed": 5,
    "circuitBreakerRejections": 2,
    "coalescing": {
      "totalCoalesced": 45,
      "currentInFlight": 2
    },
    "circuitBreaker": {
      "state": "CLOSED",
      "totalFailures": 3,
      "totalSuccesses": 117
    },
    "distributedLock": {
      "locksAcquired": 20,
      "contentions": 3
    }
  }
}
```

### Cache Statistics
```bash
GET /cache/stats
```

### Clear Cache (Testing)
```bash
POST /cache/flush
```

## Usage Examples

### Get Latest Block Number
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }'
```

### Get Block by Number
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getBlockByNumber",
    "params": ["0x10d4f", false],
    "id": 1
  }'
```

### Execute eth_call
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_call",
    "params": [{
      "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "data": "0x06fdde03"
    }, "latest"],
    "id": 1
  }'
```

### Batch Requests
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '[
    {
      "jsonrpc": "2.0",
      "method": "eth_blockNumber",
      "params": [],
      "id": 1
    },
    {
      "jsonrpc": "2.0",
      "method": "eth_getBlockByNumber",
      "params": ["0x10d4f", false],
      "id": 2
    }
  ]'
```

## Cache Behavior

### Block Caching Strategy

1. **Historical Blocks** (height ≤ PERMANENT_CACHE_HEIGHT):
   - Cached permanently (no TTL)
   - Never expires unless manually flushed

2. **Recent Blocks** (height > PERMANENT_CACHE_HEIGHT):
   - Cached with RECENT_BLOCK_TTL
   - Re-fetched after TTL expires

3. **Latest Block Number**:
   - Cached with LATEST_BLOCK_TTL (typically 2-3 seconds)
   - Ensures near real-time updates

### eth_call Caching

- Only cached for configured contract address
- Uses ETH_CALL_TTL for expiration
- Cache key includes contract address, method data, and block tag

## Performance Tips

1. **Redis Connection**: Use a local Redis instance for best performance
2. **Permanent Cache Height**: Set to a stable block height (e.g., Ethereum merge block)
3. **TTL Configuration**: Adjust TTLs based on your use case:
   - Lower TTLs for more real-time data
   - Higher TTLs for better cache hit rates

## 🐳 Docker Support

### Quick Start with Docker

#### Option 1: In-Memory Cache (No Redis Required)
```bash
# Build and run with in-memory cache + LlamaRPC
docker compose -f docker-compose.memory.yml up

# Or run standalone
docker build -t eth-rpc-proxy .
docker run -p 3000:3000 \
  -e UPSTREAM_RPC_URL=https://eth.llamarpc.com \
  -e REDIS_URL=memory \
  eth-rpc-proxy
```

#### Option 2: Production Setup with Redis
```bash
# Start proxy with Redis (includes Redis container)
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

### Docker Compose Services

The project includes a complete Docker setup with:

1. **Redis Service**: Alpine-based Redis with persistence
2. **RPC Proxy**: Multi-stage build for optimized image
3. **RedisInsight** (optional): Web UI for Redis monitoring

### Production Deployment

```bash
# Build and run in production mode
docker compose up -d

# View logs
docker compose logs -f rpc-proxy

# Monitor Redis (optional)
docker compose --profile monitoring up -d
# Open http://localhost:8001 for RedisInsight
```

### Development with Docker

```bash
# Run with hot-reload enabled
npm run docker:dev

# Or manually
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Docker Configuration

The Docker setup includes:
- **Multi-stage builds** for smaller production images
- **Non-root user** for security
- **Health checks** for both Redis and the proxy
- **Signal handling** with dumb-init
- **Volume persistence** for Redis data
- **Network isolation** between services
- **Log rotation** configuration

### Environment Variables

Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```

Required environment variables:
- `UPSTREAM_RPC_URL`: Your Ethereum RPC endpoint

### Docker Commands Reference

```bash
# Build image
docker build -t eth-rpc-cache:latest .

# Run standalone container
docker run -p 3000:3000 --env-file .env eth-rpc-cache:latest

# Docker Compose commands
docker compose up -d                    # Start in background
docker compose down                     # Stop and remove
docker compose restart rpc-proxy        # Restart proxy only
docker compose exec rpc-proxy sh        # Shell into container
docker compose ps                       # View status
```

## Testing

### Test Suites Available

The project includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run unit tests only (100% passing)
npm run test:unit

# Run integration tests
npm run test:integration

# Run simple verification (100% passing)
npm run test:simple

# Run comprehensive solution verification (100% passing)
npm run test:verify

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Test Results Summary

✅ **All core functionality tests passing:**
- **Unit Tests**: 44/44 tests passing
  - Request Coalescer: Full coverage
  - Circuit Breaker: All state transitions verified
  - Cache Manager: All operations tested
- **Simple Tests**: 7/7 tests passing
  - Verifies 10 concurrent requests → 1 upstream call
  - Circuit breaker state management
  - Failure propagation
- **Solution Verification**: 100% passing
  - **90% reduction in upstream calls achieved**
  - Cache stampede problem completely solved
  - Failure handling works correctly

### Running Tests

```bash
# Quick verification that everything works
npm run test:simple

# Comprehensive verification of the solution
npm run test:verify
```

## Monitoring

The server provides built-in metrics accessible via the `/health` endpoint:

- **cacheHits**: Number of successful cache retrievals
- **cacheMisses**: Number of cache misses requiring upstream fetch
- **totalRequests**: Total number of RPC requests processed
- **cacheHitRate**: Percentage of requests served from cache
- **coalescedRequests**: Number of requests that waited for in-flight fetches
- **circuitBreakerState**: Current state (CLOSED/OPEN/HALF_OPEN)
- **distributedLockContentions**: Number of lock wait events

## Error Handling

The server returns standard JSON-RPC error responses:

- `-32600`: Invalid Request
- `-32601`: Method not found
- `-32603`: Internal error

## How It Solves the Concurrent Request Problem

When 10 nodes make the same request simultaneously, the proxy ensures only ONE upstream call is made:

### Without Advanced Features (Problem)
```
10 Nodes → 10 Cache Misses → 10 Upstream Calls ❌
```

### With Request Coalescing (Solution)
```
10 Nodes → 1 Cache Miss + 9 Waiting → 1 Upstream Call → 10 Responses ✅
```

### Complete Request Flow
1. **Negative Cache Check**: Skip known failures
2. **Cache Check**: Return if hit (with stale support)
3. **Request Coalescing**: Wait if already in-flight
4. **Distributed Lock**: Coordinate across instances
5. **Circuit Breaker**: Protect upstream from failures
6. **Fetch & Cache**: Get from upstream and store
7. **Error Handling**: Cache failures, serve stale data

## Architecture Overview

```
Client Requests → Fastify Server 
                    ↓
                 [Negative Cache Check]
                    ↓
                 [Cache Check with Stale Support]
                    ↓ (miss)
                 [Request Coalescing]
                    ↓ (not in-flight)
                 [Distributed Lock]
                    ↓ (acquired)
                 [Circuit Breaker]
                    ↓ (closed)
                 Upstream RPC
                    ↓
                 Store in Cache
                    ↓
                 Return to All Waiting Requests
```

### Advanced Features Explained

#### Request Coalescing
- **Problem**: Multiple identical requests cause multiple upstream calls
- **Solution**: First request fetches, others wait for the result
- **Benefit**: Reduces upstream load by up to 90% during traffic spikes

#### Distributed Locking
- **Problem**: Multiple proxy instances create race conditions
- **Solution**: Redis-based locks ensure only one instance fetches
- **Benefit**: Prevents cache stampede across your entire infrastructure

#### Circuit Breaker
- **Problem**: Upstream failures cascade to all clients
- **Solution**: Temporarily block requests after repeated failures
- **Benefit**: Faster failure response, automatic recovery

#### Stale-While-Revalidate
- **Problem**: Cache expiry causes latency spikes
- **Solution**: Serve stale data immediately, refresh in background
- **Benefit**: Consistent low latency for users

## Performance Benchmarks

### With All Features Enabled
- **Cache hits**: <5ms response time
- **Coalesced requests**: <10ms (wait for in-flight)
- **Cache misses**: Upstream latency + 5-10ms overhead
- **Circuit open**: <1ms (immediate failure)
- **Throughput**: 5000+ req/s for cache hits
- **Efficiency**: 90% reduction in upstream calls during high concurrency

### Memory Usage
- **Base**: ~50MB
- **Per in-flight request**: ~1KB
- **Per circuit breaker**: ~10KB
- **Max recommended in-flight**: 1000 concurrent requests

## Troubleshooting

### Common Issues and Solutions

#### High Coalesced Request Count
- **This is good!** It means the system is preventing duplicate upstream calls
- Monitor `currentInFlight` in metrics - should return to 0
- If seeing timeouts, increase `COALESCING_TIMEOUT`

#### Circuit Breaker Opens Frequently
```bash
# Check circuit state
curl http://localhost:3000/health | jq .metrics.circuitBreaker.state

# If stuck open:
- Check upstream RPC health
- Verify network connectivity
- Review error logs for failure patterns
- Adjust CIRCUIT_FAILURE_THRESHOLD if needed
```

#### Redis Connection Issues
```bash
# Test Redis connection
redis-cli ping

# Check Redis memory
redis-cli info memory

# Clear cache if needed
redis-cli FLUSHALL
```

#### Lock Contentions High
- Multiple proxy instances competing for locks
- Solutions:
  - Increase `LOCK_TTL` slightly
  - Ensure Redis latency is low
  - Consider reducing proxy instances

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Author

Powerloom

## Version

0.1.0 - Complete solution with in-memory cache support and cache stampede prevention

---

<p align="center">
  <strong>🎆 Production Ready</strong> | <strong>✅ All Tests Passing</strong> | <strong>🚀 90% Efficiency Gain</strong>
</p>