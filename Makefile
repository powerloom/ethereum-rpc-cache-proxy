# Makefile for Ethereum RPC Cache Proxy

.PHONY: help install dev start build test clean docker-build docker-up docker-down docker-logs

# Default target
help:
	@echo "Ethereum RPC Cache Proxy - Available Commands"
	@echo "============================================="
	@echo ""
	@echo "Development:"
	@echo "  make install      - Install dependencies"
	@echo "  make dev          - Start development server with hot-reload"
	@echo "  make start        - Start production server"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build - Build Docker image"
	@echo "  make docker-up    - Start services with docker-compose"
	@echo "  make docker-down  - Stop docker compose services"
	@echo "  make docker-logs  - View docker compose logs"
	@echo "  make docker-dev   - Start development with Docker"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean        - Clean node_modules and cache"
	@echo "  make test         - Run tests (when available)"
	@echo "  make check-env    - Verify environment configuration"

# Install dependencies
install:
	npm install

# Development server
dev:
	npm run dev

# Production server
start:
	npm start

# Build Docker image
docker-build:
	./scripts/docker-build.sh

# Start Docker services
docker-up:
	docker compose up -d
	@echo "Services started. View logs with: make docker-logs"

# Stop Docker services
docker-down:
	docker compose down

# View Docker logs
docker-logs:
	docker compose logs -f

# Development with Docker
docker-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Clean dependencies and cache
clean:
	rm -rf node_modules
	rm -rf .cache
	npm cache clean --force

# Run tests
test:
	npm test

# Check environment configuration
check-env:
	@if [ ! -f .env ]; then \
		echo "❌ .env file not found!"; \
		echo "Creating from .env.example..."; \
		cp .env.example .env; \
		echo "✅ Created .env file. Please configure it with your settings."; \
	else \
		echo "✅ .env file exists"; \
		@grep -q "your-api-key" .env && echo "⚠️  Warning: Default API key detected in .env" || echo "✅ API key configured"; \
	fi