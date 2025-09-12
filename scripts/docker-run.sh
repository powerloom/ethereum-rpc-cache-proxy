#!/bin/bash

# Run script for Docker container
set -e

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env file from .env.example:"
    echo "  cp .env.example .env"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Check if UPSTREAM_RPC_URL is set
if [ -z "$UPSTREAM_RPC_URL" ] || [ "$UPSTREAM_RPC_URL" = "https://eth-mainnet.g.alchemy.com/v2/your-api-key" ]; then
    echo "❌ Error: UPSTREAM_RPC_URL not configured!"
    echo "Please edit .env and set your Ethereum RPC URL"
    exit 1
fi

echo "🚀 Starting Ethereum RPC Cache Proxy..."
echo ""

# Run with docker-compose
docker compose up -d

echo ""
echo "✅ Services started successfully!"
echo ""
echo "📊 Service URLs:"
echo "  - RPC Proxy: http://localhost:3000"
echo "  - Health Check: http://localhost:3000/health"
echo "  - Cache Stats: http://localhost:3000/cache/stats"
echo ""
echo "📝 Useful commands:"
echo "  - View logs: docker compose logs -f"
echo "  - Stop services: docker compose down"
echo "  - Restart services: docker compose restart"
echo "  - Clear cache: curl -X POST http://localhost:3000/cache/flush"
echo ""
echo "🔍 To monitor with RedisInsight (optional):"
echo "  docker compose --profile monitoring up -d"
echo "  Then open: http://localhost:8001"