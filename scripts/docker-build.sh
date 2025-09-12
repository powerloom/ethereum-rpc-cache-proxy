#!/bin/bash

# Build script for Docker image
set -e

echo "🔨 Building Ethereum RPC Cache Proxy Docker image..."

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# Build the image with multiple tags
docker build \
  -t eth-rpc-cache:latest \
  -t eth-rpc-cache:${VERSION} \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VERSION=${VERSION} \
  .

echo "✅ Successfully built eth-rpc-cache:${VERSION}"
echo ""
echo "📦 Image tags:"
echo "  - eth-rpc-cache:latest"
echo "  - eth-rpc-cache:${VERSION}"
echo ""
echo "To run the container:"
echo "  docker run -p 3000:3000 --env-file .env eth-rpc-cache:latest"
echo ""
echo "Or use docker-compose:"
echo "  docker-compose up -d"