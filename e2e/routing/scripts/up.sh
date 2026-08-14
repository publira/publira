#!/usr/bin/env bash
# Bring up Traefik + the echo `app` from the real Dev Container labels.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_routing_lock

routing_log "=== up (project=${COMPOSE_PROJECT_NAME}) ==="

# Safe: this process (or its parent run.sh) holds the project lock.
compose down -v --remove-orphans

for port in "${ROUTING_TRAEFIK_PORT}" "${ROUTING_TRAEFIK_API_PORT}"; do
  if port_in_use "${port}"; then
    routing_fail "port ${port} is already in use; free it or override ROUTING_TRAEFIK_PORT / ROUTING_TRAEFIK_API_PORT"
  fi
done

if [[ ! -f "${ROUTING_ECHO_PY}" ]]; then
  routing_fail "echo server missing: ${ROUTING_ECHO_PY}"
fi

routing_log "starting traefik + echo app from .devcontainer/compose.yaml"
# --wait is on `app` (healthcheck). Traefik has no healthcheck; routers are
# polled separately once Docker has advertised the labels.
compose up -d --wait --wait-timeout 60 app traefik

routing_log "up complete"
