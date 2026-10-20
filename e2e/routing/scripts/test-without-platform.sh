#!/usr/bin/env bash
# Probe an edge started with PUBLIRA_ROUTING_PLATFORM_HOSTS empty, the install
# that runs no web-platform: the other two apps are routed as before, and the
# hosts the platform list used to hold reach nothing.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ -n "${PUBLIRA_ROUTING_PLATFORM_HOSTS// /}" ]]; then
  routing_fail "PUBLIRA_ROUTING_PLATFORM_HOSTS is '${PUBLIRA_ROUTING_PLATFORM_HOSTS}' (want it empty)"
fi

routing_log "=== route probes with no platform hosts ==="

assert_route "web-storefront listed host" GET localhost / web-storefront /
assert_route "web-admin listed host" GET admin.localhost / web-admin /
assert_route "rpc on a listed host" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "images on a listed host" GET admin.localhost /images/cover api /images/cover

assert_unrouted "platform host once no list names it" GET platform.localhost /
assert_unrouted "platform host on /rpc once no list names it" GET operators.example.net "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unrouted "platform host on /api once no list names it" GET operators.example.net "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"

routing_log "=== route probes with no platform hosts passed ==="
