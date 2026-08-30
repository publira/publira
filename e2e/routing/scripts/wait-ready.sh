#!/usr/bin/env bash
# Wait until Traefik has advertised every labeled router and middleware on its
# insecure API.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# All of `${names[@]}` present in the newline-separated `${advertised}`, each
# suffixed with the Docker provider namespace Traefik appends.
all_advertised() {
  local advertised="$1"
  shift
  local name
  for name in "$@"; do
    grep -qx "${name}@docker" <<<"${advertised}" || return 1
  done
}

routing_log "waiting for Traefik routers + middlewares (timeout ${ROUTING_READY_TIMEOUT_SEC}s)"

deadline=$((SECONDS + ROUTING_READY_TIMEOUT_SEC))
while ((SECONDS < deadline)); do
  routers="$(traefik_router_names 2>/dev/null || true)"
  middlewares="$(traefik_middleware_names 2>/dev/null || true)"
  if all_advertised "${routers}" "${ROUTING_ROUTERS[@]}" &&
    all_advertised "${middlewares}" "${ROUTING_MIDDLEWARES[@]}"; then
    routing_log "ok: ${#ROUTING_ROUTERS[@]} routers + ${#ROUTING_MIDDLEWARES[@]} middlewares advertised"
    exit 0
  fi
  sleep "${ROUTING_READY_INTERVAL_SEC}"
done

routing_err "advertised routers:"
traefik_router_names >&2 || true
routing_err "advertised middlewares:"
traefik_middleware_names >&2 || true
routing_fail "readiness failed: traefik-routers"
