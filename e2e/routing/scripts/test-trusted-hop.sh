#!/usr/bin/env bash
# Probe an edge started with its sample's trusted-proxy setting enabled for the
# hop's address alone: a request through the hop reaches the backend with the
# client address the hop named, and a request from anywhere else is treated as
# it is without the setting, its forged client address replaced by the peer
# address.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ "${PUBLIRA_ROUTING_TRUSTED_HOP}" != "1" ]]; then
  routing_fail "PUBLIRA_ROUTING_TRUSTED_HOP is '${PUBLIRA_ROUTING_TRUSTED_HOP}' (want 1)"
fi

routing_log "=== route probes behind a trusted hop ==="

assert_hop_client_address "web-host through the trusted hop" localhost / web-host
assert_hop_client_address "web-admin through the trusted hop" admin.localhost / web-admin
assert_hop_client_address "api through the trusted hop" localhost /api/foo api
assert_hop_client_address "images through the trusted hop" admin.localhost /images/cover api

# The host is outside the trusted range, so its forged headers are replaced as
# they are on an edge that trusts nothing.
assert_forwarded_headers "web-host from outside the trusted range" GET localhost / web-host
assert_forwarded_headers "api from outside the trusted range" GET localhost /api/foo api

# Traefik takes its read timeout from the static configuration, which only
# this pass starts from traefik.yaml; the others start from the Dev
# Container's flags. nginx and Caddy start from the same sample either way.
if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" ]]; then
  assert_upload_delivered "page upload of 256 MiB over 75 seconds reaches web-admin whole" admin.localhost /api/v1/episode-pages web-admin 268435456 75
fi

routing_log "=== route probes behind a trusted hop passed ==="
