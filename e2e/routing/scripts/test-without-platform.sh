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

assert_route "web-host listed host" GET localhost / web-host /
assert_route "web-admin listed host" GET admin.localhost / web-admin /
assert_route "api on a listed host" GET localhost /api/foo api /api/foo
assert_route "images on a listed host" GET admin.localhost /images/cover api /images/cover

assert_unrouted "platform host once no list names it" GET platform.localhost /
assert_unrouted "platform host on /api once no list names it" GET operators.example.net /api/foo

routing_log "=== route probes with no platform hosts passed ==="
