# Changelog

All notable changes to the Ethereum RPC Cache Proxy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2025-11-20

### Security
- Fixed 4 npm package vulnerabilities (glob, js-yaml, pino, fast-redact) by updating dependencies

## [0.2.0] - 2025-10-13

### Added
- **Multi-URL Fallback Support** - Automatic failover to backup RPC providers
  - Auto-detection of comma-separated URLs in `UPSTREAM_RPC_URL`
  - Intelligent retry logic with URL rotation
  - Per-URL health tracking and metrics
  - Automatic recovery of failed URLs (re-enabled after 1 minute)
  - URL sanitization in logs to hide API keys
  - Health endpoint shows all RPC providers and their status
  - 100% backward compatible with single URL configurations
- New configuration options:
  - `RPC_FALLBACK_ENABLED` - Enable/disable fallback (default: true)
  - `RPC_MAX_RETRIES_PER_URL` - Retries per URL before moving to next (default: 2)
- New test suite for multi-URL fallback scenarios (10 additional tests)
- Manual test script `tests/test-multi-url.js` for integration testing

### Changed
- Enhanced `/health` endpoint to include `rpcProviders` array with detailed status
- Improved error messages to indicate when all RPC endpoints have failed
- Updated startup message to show number of configured RPC URLs

### Fixed
- URL sanitization now properly hides API keys in various formats (v2/, v3/, etc.)

## [0.1.0] - 2025-09-16 (Initial Release)

### Added
- **Complete Ethereum JSON-RPC Support** - All 45+ methods with intelligent caching
- **Cache Stampede Prevention** - Request coalescing for concurrent identical requests
- **Dual Cache Backend** - Support for both Redis and in-memory caching
- **Auto-detection** - Automatically falls back to in-memory cache if Redis unavailable
- **Cache Transparency** - All responses include `cached` field
- **Advanced Features**:
  - Request Coalescer - Prevents duplicate concurrent requests
  - Circuit Breaker - Protects upstream from cascading failures
  - Distributed Lock - Coordinates multiple proxy instances (Redis only)
  - Stale-While-Revalidate - Serve stale data while fetching fresh
  - Negative Caching - Cache failed requests to prevent repeated failures
- **Method-Specific Caching** (`src/config/methodCaching.js`):
  - Immutable data (receipts, old blocks) - Permanent cache
  - Block data - Smart TTL based on finality
  - Account state - Short TTL (15s)
  - Gas prices - Very short TTL (5s)
  - Network info - Long TTL (1h)
  - Write operations - Never cached
- **Health Monitoring**:
  - `/health` endpoint with detailed metrics
  - `/cache/stats` for cache statistics
  - `/cache/flush` for testing (clears cache)
- **Docker Support**:
  - Multi-platform builds (linux/amd64, linux/arm64)
  - Published to GitHub Container Registry
  - Docker Compose configurations for Redis and in-memory modes
- **CI/CD Pipeline**:
  - GitHub Actions for automated testing
  - Multi-version Node.js testing (20.x, 22.x)
  - Security scanning with npm audit and Trivy
  - Automated Docker image building and publishing
- **Comprehensive Test Suite**:
  - Unit tests for all components
  - Integration tests for RPC handling
  - Performance verification tests
  - Simple test scripts for quick validation

### Performance
- **90% reduction** in upstream RPC calls through intelligent caching
- **<5ms response time** for cache hits
- **5000+ req/s throughput** for cached data
- **~50MB base memory** usage

---

## Upgrade Guide

### From 0.1.0 to 0.2.0

No breaking changes! The multi-URL fallback feature is fully backward compatible.

To use the new fallback feature, simply provide comma-separated URLs:
```env
# Before (still works)
UPSTREAM_RPC_URL=https://eth.llamarpc.com

# After (with fallback)
UPSTREAM_RPC_URL=https://eth.llamarpc.com,https://mainnet.infura.io/v3/key,https://eth-mainnet.g.alchemy.com/v2/key
```

New optional configuration:
```env
# Configure fallback behavior (all optional)
RPC_FALLBACK_ENABLED=true      # Enable/disable fallback (default: true)
RPC_MAX_RETRIES_PER_URL=2      # Retries per URL before moving to next (default: 2)
```

---

## Migration Notes

### Single to Multiple RPC URLs

The proxy now automatically detects multiple URLs when comma-separated. No code changes needed!

```env
# Single URL (unchanged)
UPSTREAM_RPC_URL=https://primary.rpc.com

# Multiple URLs (automatic fallback)
UPSTREAM_RPC_URL=https://primary.rpc.com,https://backup1.rpc.com,https://backup2.rpc.com
```

### Monitoring Multiple URLs

The `/health` endpoint now includes detailed information about all RPC providers:

```json
{
  "rpcProviders": [
    {
      "url": "https://eth.llamarpc.com/",
      "healthy": true,
      "failureCount": 0,
      "successCount": 150
    },
    {
      "url": "https://mainnet.infura.io/[API_KEY]",
      "healthy": false,
      "failureCount": 3,
      "lastError": "timeout"
    }
  ]
}
```

---

## Links

- [GitHub Repository](https://github.com/powerloom/ethereum-rpc-cache-proxy)
- [Docker Images](https://ghcr.io/powerloom/ethereum-rpc-cache-proxy)
- [Issue Tracker](https://github.com/powerloom/ethereum-rpc-cache-proxy/issues)
- [Latest Release](https://github.com/powerloom/ethereum-rpc-cache-proxy/releases/tag/v0.2.1)

[0.2.1]: https://github.com/powerloom/ethereum-rpc-cache-proxy/releases/tag/v0.2.1
[0.2.0]: https://github.com/powerloom/ethereum-rpc-cache-proxy/releases/tag/v0.2.0
[0.1.0]: https://github.com/powerloom/ethereum-rpc-cache-proxy/releases/tag/v0.1.0