#!/bin/bash
set -e

echo "================================================"
echo "  TenderMind AI — Boardroom Simulation Engine"
echo "================================================"

# Ensure .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example and fill in your values."
  exit 1
fi

# Export .env variables for docker-compose substitution
set -a
source .env
set +a

echo "[1/3] Pulling latest images..."
docker compose pull --quiet 2>/dev/null || true

echo "[2/3] Building and starting all services..."
docker compose up -d

echo "[3/3] Waiting for services to become healthy..."
for i in $(seq 1 30); do
  DB_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' boardroom-db 2>/dev/null || echo "starting")
  BE_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' boardroom-backend 2>/dev/null || echo "starting")

  if [ "$DB_HEALTH" = "healthy" ] && [ "$BE_HEALTH" = "healthy" ]; then
    break
  fi

  if [ $i -eq 30 ]; then
    echo "WARNING: Services may not be fully healthy yet. Check logs with: docker compose logs"
  fi

  printf "  Waiting... (db: %s, backend: %s)\r" "$DB_HEALTH" "$BE_HEALTH"
  sleep 3
done

echo ""
echo "================================================"
echo "  All services started!"
echo ""
echo "  Frontend:  http://localhost:4200"
echo "  Backend:   http://localhost:3000"
echo "  Health:    http://localhost:3000/health"
echo ""
echo "  Mock Login: http://localhost:3000/api/auth/mock-login"
echo ""
echo "  Logs: docker compose logs -f"
echo "  Stop: docker compose down"
echo "================================================"
