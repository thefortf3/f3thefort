#!/usr/bin/env bash
# Deploy newsletter to production VPS.
# Builds the Docker image locally, ships it to the server, and restarts the container.
# Run from the project root: ./scripts/deploy.sh
set -euo pipefail

SSH_HOST="root@198.46.194.165"
REMOTE_DIR="/home/user/newsletter2"
IMAGE="newsletter:latest"

echo "[1/4] Building image..."
docker build -t "${IMAGE}" .

echo "[2/4] Syncing config files..."
scp docker-compose.yml nginx.conf "${SSH_HOST}:${REMOTE_DIR}/"

echo "[3/4] Transferring image to server..."
docker save "${IMAGE}" | gzip | ssh "${SSH_HOST}" "gunzip | docker load"

echo "[4/4] Restarting container..."
ssh "${SSH_HOST}" "docker compose --project-directory ${REMOTE_DIR} up -d --no-deps newsletter"
ssh "${SSH_HOST}" "docker logs newsletter 2>&1 | tail -5"

echo "Done — https://submit.f3thefort.com"
