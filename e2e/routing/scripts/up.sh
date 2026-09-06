#!/usr/bin/env bash
# Bring up the proxy plus the echo backends behind it.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_routing_lock

routing_log "=== up (project=${COMPOSE_PROJECT_NAME}) ==="

# Safe: this process (or its parent run-one.sh) holds the project lock.
compose down -v --remove-orphans

for port in "${ROUTING_PUBLISHED_PORTS[@]}"; do
  if port_in_use "${port}"; then
    routing_fail "port ${port} is already in use; free it or override ROUTING_EDGE_PORT / ROUTING_TRAEFIK_API_PORT"
  fi
done

if [[ ! -f "${ROUTING_ECHO_PY}" ]]; then
  routing_fail "echo server missing: ${ROUTING_ECHO_PY}"
fi

# The Traefik run is the Dev Container's own edge, so it starts that service by
# name; nginx and Caddy come from a compose file of their own whose only other
# service is the echo `app`.
if [[ "${ROUTING_PROXY}" == "traefik" ]]; then
  routing_log "starting traefik + echo app from .devcontainer/compose.yaml"
  # --wait is on `app` (healthcheck). Traefik has no healthcheck; its routers
  # are polled separately once the file provider has read them.
  compose up -d --wait --wait-timeout 60 app traefik
else
  routing_log "starting ${ROUTING_PROXY} + echo app"
  compose up -d --wait --wait-timeout 60
fi

routing_log "up complete"
