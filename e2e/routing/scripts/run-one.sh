#!/usr/bin/env bash
# Edge routing check for one proxy.
#
#   up → wait for the edge to serve → probe hosts / /rpc / /images
#   → up again with no platform or image hosts → wait → probe what that leaves
#   → for Caddy, up again terminating TLS → wait → probe over HTTPS
#   → up again behind a trusted hop → wait → probe the client address
#   → up again behind the hop with every limit on → wait → send bursts → down
#
# Always tears down (success, failure, or interrupt) and collects Compose
# output — and, for Traefik, its API — into e2e/routing/.run/<proxy>/logs when
# the run fails.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_routing_lock

for cmd in docker curl; do
  if ! command -v "${cmd}" > /dev/null 2>&1; then
    routing_fail "required command not found: ${cmd}"
  fi
done

cleanup_done=0
cleanup() {
  local status="${1:-$?}"
  if [[ "${cleanup_done}" -eq 1 ]]; then
    return
  fi
  cleanup_done=1
  if [[ "${status}" -ne 0 ]]; then
    collect_diagnostics
  fi
  # Preserve the probe/signal status even if teardown itself fails.
  bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/down.sh" ||
    routing_err "teardown failed (exit $?); compose project ${COMPOSE_PROJECT_NAME} may still be up"
}

on_signal() {
  local signal="$1"
  local status=$((128 + $(kill -l "${signal}")))
  routing_err "received SIG${signal}; aborting"
  cleanup "${status}"
  trap - EXIT
  exit "${status}"
}

trap cleanup EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

routing_log "=== routing check start (project=${COMPOSE_PROJECT_NAME}) ==="

bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test.sh"

# An install that runs no web-platform and gives no tenant an image host leaves
# both lists empty and removes nothing from the sample, so the same files have
# to start with empty lists and still route the other two apps.
export PUBLIRA_ROUTING_PLATFORM_HOSTS=""
export PUBLIRA_ROUTING_IMAGE_HOSTS=""
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test-empty-lists.sh"

# The Caddyfile terminates TLS itself once it is given the host lists as its
# site addresses, which the Compose install does, so Caddy runs a third time
# that way. The same compose files start it, with its own host lists.
if [[ "${PUBLIRA_ROUTING_PROXY}" == "caddy" ]]; then
  export PUBLIRA_ROUTING_TLS=1
  # shellcheck source=lib.sh
  source "${PUBLIRA_ROUTING_SCRIPTS_DIR}/lib.sh"
  bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
  bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
  bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test-tls.sh"
  export PUBLIRA_ROUTING_TLS=0
  export PUBLIRA_ROUTING_PLATFORM_HOSTS=""
fi

# Each sample carries a trusted-proxy setting, commented out, for an install
# with a load balancer or a TLS terminator in front of the edge. Enabled as it
# is written, it has to let that hop name the client address and nobody else.
# This pass starts other compose files, so the stack before it is torn down
# with its own, and lib.sh is sourced again for the teardown and the
# diagnostics to address the new ones. The image hosts are listed again, so
# that the hop reaches one too.
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/down.sh"
export PUBLIRA_ROUTING_TRUSTED_HOP=1
unset PUBLIRA_ROUTING_IMAGE_HOSTS
# shellcheck source=lib.sh
source "${PUBLIRA_ROUTING_SCRIPTS_DIR}/lib.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test-trusted-hop.sh"

# Each sample limits how many requests one client may send. The probes above
# send few enough to stay within every allowance, and a burst over one is
# answered 429 until it refills, so the bursts get a proxy of their own, with
# every allowance full. They run behind the same hop, so that a client the hop
# names is counted apart from every other one, and Caddy's sample, which
# carries its limits commented out, is started with them uncommented. The
# Platform Console's hosts are listed again, so that the bursts reach one too.
export PUBLIRA_ROUTING_RATE_LIMITS=1
unset PUBLIRA_ROUTING_PLATFORM_HOSTS
# shellcheck source=lib.sh
source "${PUBLIRA_ROUTING_SCRIPTS_DIR}/lib.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test-rate-limits.sh"

routing_log "=== routing check succeeded ==="
