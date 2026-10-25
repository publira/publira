#!/usr/bin/env bash
# Probe an edge started with PUBLIRA_ROUTING_PLATFORM_HOSTS and
# PUBLIRA_ROUTING_IMAGE_HOSTS empty, the install that runs no web-platform and
# gives no tenant an image host: the other two apps are routed as before, and
# the hosts the emptied lists used to hold reach nothing.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ -n "${PUBLIRA_ROUTING_PLATFORM_HOSTS// /}" ]]; then
  routing_fail "PUBLIRA_ROUTING_PLATFORM_HOSTS is '${PUBLIRA_ROUTING_PLATFORM_HOSTS}' (want it empty)"
fi
if [[ -n "${PUBLIRA_ROUTING_IMAGE_HOSTS// /}" ]]; then
  routing_fail "PUBLIRA_ROUTING_IMAGE_HOSTS is '${PUBLIRA_ROUTING_IMAGE_HOSTS}' (want it empty)"
fi

routing_log "=== route probes with no platform or image hosts ==="

assert_route "web-storefront listed host" GET localhost / web-storefront /
assert_route "web-admin listed host" GET admin.localhost / web-admin /
assert_route "rpc on a listed host" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "images on a listed host" GET admin.localhost /images/cover api /images/cover

assert_unrouted "platform host once no list names it" GET platform.localhost /
assert_unrouted "platform host on /rpc once no list names it" GET operators.example.net "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unrouted "platform host on /api once no list names it" GET operators.example.net "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unrouted "image host on /images once no list names it" GET pictures.example.net /images/cover
assert_unrouted "image host named like a console on /images once no list names it" GET admin.art.example.com /images/cover

routing_log "=== route probes with no platform or image hosts passed ==="
