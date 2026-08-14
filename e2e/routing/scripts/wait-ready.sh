#!/usr/bin/env bash
# Wait until Traefik has advertised every labeled router on its insecure API.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

routing_log "waiting for Traefik routers (timeout ${ROUTING_READY_TIMEOUT_SEC}s)"

deadline=$((SECONDS + ROUTING_READY_TIMEOUT_SEC))
while ((SECONDS < deadline)); do
  names="$(traefik_router_names 2>/dev/null || true)"
  missing=0
  for router in "${ROUTING_ROUTERS[@]}"; do
    if ! grep -qx "${router}@docker" <<<"${names}"; then
      missing=1
      break
    fi
  done
  if [[ "${missing}" -eq 0 ]]; then
    routing_log "ok: all ${#ROUTING_ROUTERS[@]} routers advertised"
    exit 0
  fi
  sleep "${ROUTING_READY_INTERVAL_SEC}"
done

routing_err "advertised routers:"
traefik_router_names >&2 || true
routing_fail "readiness failed: traefik-routers"
