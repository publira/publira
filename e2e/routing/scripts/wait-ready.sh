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
    grep -qx "${name}@file" <<< "${advertised}" || return 1
  done
}

traefik_ready() {
  local routers middlewares
  routers="$(traefik_router_names 2> /dev/null || true)"
  middlewares="$(traefik_middleware_names 2> /dev/null || true)"
  all_advertised "${routers}" "${PUBLIRA_ROUTING_ROUTERS[@]}" &&
    all_advertised "${middlewares}" "${PUBLIRA_ROUTING_MIDDLEWARES[@]}"
}

if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" ]]; then
  routing_log "waiting for Traefik routers + middlewares (timeout ${PUBLIRA_ROUTING_READY_TIMEOUT_SEC}s)"
else
  routing_log "waiting for the ${PUBLIRA_ROUTING_PROXY} edge to answer (timeout ${PUBLIRA_ROUTING_READY_TIMEOUT_SEC}s)"
fi

deadline=$((SECONDS + PUBLIRA_ROUTING_READY_TIMEOUT_SEC))
while ((SECONDS < deadline)); do
  if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" ]]; then
    if traefik_ready; then
      routing_log "ok: ${#PUBLIRA_ROUTING_ROUTERS[@]} routers + ${#PUBLIRA_ROUTING_MIDDLEWARES[@]} middlewares advertised"
      exit 0
    fi
  elif edge_serves_web_host; then
    routing_log "ok: the edge answers on :${PUBLIRA_ROUTING_EDGE_PORT}"
    exit 0
  fi
  sleep "${PUBLIRA_ROUTING_READY_INTERVAL_SEC}"
done

if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" ]]; then
  routing_err "advertised routers:"
  traefik_router_names >&2 || true
  routing_err "advertised middlewares:"
  traefik_middleware_names >&2 || true
  routing_fail "readiness failed: traefik-routers"
fi

routing_fail "readiness failed: the ${PUBLIRA_ROUTING_PROXY} edge did not serve web-host on :${PUBLIRA_ROUTING_EDGE_PORT}"
