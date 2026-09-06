#!/usr/bin/env bash
# Wait until the edge is serving the contract.
#
# Traefik is asked through its insecure API, because a router or the
# entrypoint middleware that has not loaded yet is the difference between one
# readable message and a wall of failing probes. nginx and Caddy have the
# whole configuration before they accept a connection, so for them readiness
# is the first request the catch-all answers.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# All of `${names[@]}` present in the newline-separated `${advertised}`, each
# suffixed with the file provider namespace Traefik appends.
all_advertised() {
  local advertised="$1"
  shift
  local name
  for name in "$@"; do
    grep -qx "${name}@file" <<<"${advertised}" || return 1
  done
}

traefik_ready() {
  local routers middlewares
  routers="$(traefik_router_names 2>/dev/null || true)"
  middlewares="$(traefik_middleware_names 2>/dev/null || true)"
  all_advertised "${routers}" "${ROUTING_ROUTERS[@]}" &&
    all_advertised "${middlewares}" "${ROUTING_MIDDLEWARES[@]}"
}

if [[ "${ROUTING_PROXY}" == "traefik" ]]; then
  routing_log "waiting for Traefik routers + middlewares (timeout ${ROUTING_READY_TIMEOUT_SEC}s)"
else
  routing_log "waiting for the ${ROUTING_PROXY} edge to answer (timeout ${ROUTING_READY_TIMEOUT_SEC}s)"
fi

deadline=$((SECONDS + ROUTING_READY_TIMEOUT_SEC))
while ((SECONDS < deadline)); do
  if [[ "${ROUTING_PROXY}" == "traefik" ]]; then
    if traefik_ready; then
      routing_log "ok: ${#ROUTING_ROUTERS[@]} routers + ${#ROUTING_MIDDLEWARES[@]} middlewares advertised"
      exit 0
    fi
  elif edge_serves_web_host; then
    routing_log "ok: the edge answers on :${ROUTING_EDGE_PORT}"
    exit 0
  fi
  sleep "${ROUTING_READY_INTERVAL_SEC}"
done

if [[ "${ROUTING_PROXY}" == "traefik" ]]; then
  routing_err "advertised routers:"
  traefik_router_names >&2 || true
  routing_err "advertised middlewares:"
  traefik_middleware_names >&2 || true
  routing_fail "readiness failed: traefik-routers"
fi

routing_fail "readiness failed: the ${ROUTING_PROXY} edge did not serve web-host on :${ROUTING_EDGE_PORT}"
