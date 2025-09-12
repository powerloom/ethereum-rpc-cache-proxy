# Docker Deployment Guide

## 🚀 Quick Start

### Without Redis (In-Memory Cache)
```bash
# Simple - just the proxy with in-memory cache
docker compose up rpc-proxy

# Or explicitly set REDIS_URL to memory
REDIS_URL=memory docker compose up rpc-proxy
```

### With Redis (Production)
```bash
# Start proxy + Redis using profiles
docker compose --profile with-redis up

# Or use environment variable
WITH_REDIS=true docker compose --profile with-redis up
```

## 📋 Docker Compose Options

### Method 1: Using Profiles (Recommended)

The main `docker-compose.yml` uses Docker profiles to make Redis optional:

```bash
# Run WITHOUT Redis (in-memory cache)
docker compose up

# Run WITH Redis
docker compose --profile with-redis up

# Run in background
docker compose --profile with-redis up -d
```

### Method 2: Environment Variables

Control cache backend via `REDIS_URL`:

```bash
# Use in-memory cache
REDIS_URL=memory docker compose up

# Use Redis (when running with profile)
REDIS_URL=redis://redis:6379 docker compose --profile with-redis up

# Use external Redis
REDIS_URL=redis://my-redis-server:6379 docker compose up
```

### Method 3: Separate Compose Files

```bash
# In-memory only (no Redis container)
docker compose -f docker-compose.memory.yml up

# With Redis (includes Redis container)
docker compose -f docker-compose.yml --profile with-redis up
```

## 🎯 Configuration Examples

### Development Setup
```bash
# Quick start with in-memory cache and LlamaRPC
REDIS_URL=memory docker compose up
```

### Production Setup
```bash
# With Redis, custom RPC, and port
UPSTREAM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY \
HOST_PORT=8080 \
docker compose --profile with-redis up -d
```

### Custom Ports
```bash
# Change external port only
HOST_PORT=8080 docker compose up

# Change both internal and external ports
HOST_PORT=8080 PORT=8080 docker compose up

# Redis on custom port (when using Redis profile)
REDIS_PORT=6380 docker compose --profile with-redis up
```

### Using .env File

Create a `.env` file in the project root:

```env
# Cache backend (redis://... or 'memory')
REDIS_URL=memory

# Or use WITH_REDIS flag
# WITH_REDIS=true

# Upstream RPC
UPSTREAM_RPC_URL=https://eth.llamarpc.com

# Ports
HOST_PORT=3000
PORT=3000
REDIS_PORT=6379

# Cache settings
PERMANENT_CACHE_HEIGHT=15537393
LATEST_BLOCK_TTL=2
ETH_CALL_TTL=300
RECENT_BLOCK_TTL=60
```

Then run:
```bash
# Without Redis (if REDIS_URL=memory in .env)
docker compose up

# With Redis (if WITH_REDIS=true in .env)
docker compose --profile with-redis up
```

## 🔧 Advanced Usage

### Build Custom Image
```bash
# Build with specific tag
docker build -t my-rpc-proxy:latest .

# Use custom image in docker-compose
IMAGE=my-rpc-proxy:latest docker compose up
```

### Connect to External Redis
```bash
# Use external Redis instead of container
REDIS_URL=redis://username:password@redis.example.com:6379/0 \
docker compose up
```

### Multi-Instance Setup
```bash
# Run multiple proxy instances with shared Redis
docker compose --profile with-redis up --scale rpc-proxy=3
```

### Debug Mode
```bash
# Verbose logging
LOG_LEVEL=debug docker compose up

# Interactive mode for debugging
docker compose run --rm rpc-proxy sh
```

## 📊 Monitoring

### Health Checks
```bash
# Check health status
curl http://localhost:3000/health | jq

# Monitor container health
docker ps
docker inspect eth-rpc-proxy --format='{{.State.Health.Status}}'
```

### View Logs
```bash
# All logs
docker compose logs -f

# Proxy logs only
docker compose logs -f rpc-proxy

# Redis logs (when using Redis)
docker compose logs -f redis
```

### Cache Statistics
```bash
# View cache stats
curl http://localhost:3000/cache/stats | jq

# Check cache type (redis or memory)
curl http://localhost:3000/health | jq .cacheType
```

## 🛠️ Troubleshooting

### Redis Connection Issues
```bash
# If Redis fails to connect, proxy auto-falls back to in-memory cache
# Check logs for fallback message:
docker compose logs rpc-proxy | grep "memory cache"
```

### Port Conflicts
```bash
# Use different ports
HOST_PORT=3001 REDIS_PORT=6380 docker compose --profile with-redis up
```

### Memory Issues
```bash
# Increase memory limits
docker compose run --rm -m 512m rpc-proxy
```

### Clean Restart
```bash
# Stop and remove everything
docker compose down -v

# Remove all data including Redis volume
docker compose --profile with-redis down -v
```

## 🏗️ Docker Compose File Structure

- **`docker-compose.yml`**: Main file with optional Redis (via profiles)
- **`docker-compose.memory.yml`**: Simplified in-memory only setup
- **`docker-compose.override.yml`**: Flexible configuration for overrides
- **`Dockerfile`**: Multi-stage build for production image
- **`.dockerignore`**: Optimizes build context

## 📝 Summary

The Docker setup provides maximum flexibility:

1. **Zero-dependency mode**: Run without Redis using in-memory cache
2. **Production mode**: Full Redis-backed caching with persistence
3. **Hybrid mode**: Connect to external Redis
4. **Profile-based**: Redis is optional via Docker profiles
5. **Environment-driven**: Control everything via environment variables

Choose the mode that fits your needs:
- **Development**: Use in-memory cache for simplicity
- **Testing**: Use Redis profile for realistic testing
- **Production**: Use Redis with persistence for reliability