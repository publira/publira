#!/usr/bin/env bash
# Edge routing check, for every proxy under infra/proxy.
#
# One stack at a time, torn down before the next starts, because all three
# publish the same edge port. Set PUBLIRA_ROUTING_PROXY to narrow the run to one
# proxy, or to a space-separated subset.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -ra proxies <<< "${PUBLIRA_ROUTING_PROXY:-traefik nginx caddy}"

for proxy in "${proxies[@]}"; do
  PUBLIRA_ROUTING_PROXY="${proxy}" bash "${SCRIPTS_DIR}/run-one.sh"
done
