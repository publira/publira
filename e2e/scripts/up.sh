#!/usr/bin/env bash
# Start the stack's containers: every service, or only the ones named.
#   up.sh [service...]
# A run that does not use one leaves it out rather than waiting for it. The
# mobile suite, which drives no web app, starts neither traefik nor the
# browser, whose image is the one service built rather than pulled.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_e2e_lock

# The backend addresses this run's edge uses. compose.yaml mounts the
# repository's infra/proxy/traefik/dynamic and lays this file over the
# services.yaml in it, so the routers are the ones every environment runs and
# only the addresses are written here — the ports are overridable
# (PUBLIRA_E2E_WEB_STOREFRONT_PORT and the rest) and a file provider substitutes
# no variables of its own.
#
# `localhost` rather than a literal address: web-storefront is started with
# HOSTNAME=localhost and Next resolves that to ::1 alone, while publira server
# binds every address. Only a name covers both, and it keeps working when
# PUBLIRA_E2E_WEB_BIND_HOST moves web-storefront to an IPv4 address instead.
e2e_log "writing traefik services to ${PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR}/services.yaml"
cat > "${PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR}/services.yaml" << EOF
http:
  services:
    web-storefront:
      loadBalancer:
        servers:
          - url: "http://localhost:${PUBLIRA_E2E_WEB_STOREFRONT_PORT}"
    web-admin:
      loadBalancer:
        servers:
          - url: "http://localhost:${PUBLIRA_E2E_WEB_ADMIN_PORT}"
    web-platform:
      loadBalancer:
        servers:
          - url: "http://localhost:${PUBLIRA_E2E_WEB_PLATFORM_PORT}"
    api:
      loadBalancer:
        servers:
          - url: "http://localhost:${PUBLIRA_E2E_PUBLIC_API_PORT}"
EOF

# The routers as the repository writes them, with every request-rate allowance
# raised past anything the suite sends. Every spec reaches the edge from
# loopback, so the specs running at one moment would share one client's
# allowance and refuse each other at random; `task e2e:routing` is what holds
# the allowances themselves to infra/proxy/README.md.
routes="${REPO_ROOT}/infra/proxy/traefik/dynamic/routes.yaml"
unlimited='"average" 1000000 "burst" 1000000'
e2e_log "writing traefik routes with the request-rate allowances raised to ${PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR}/routes.yaml"
sed -E "s/\"average\" [0-9]+ \"burst\" [0-9]+/${unlimited}/g" "${routes}" > "${PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR}/routes.yaml"
# An allowance written in any other shape would be left as it is, so every one
# routes.yaml names has to have come out raised.
allowances="$(grep -oE '"average" [0-9]+' "${routes}" | wc -l)"
raised="$(grep -oF "${unlimited}" "${PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR}/routes.yaml" | wc -l)"
if [[ "${allowances}" -eq 0 || "${raised}" -ne "${allowances}" ]]; then
  e2e_err "raised ${raised} of the ${allowances} allowances in ${routes}; update up.sh to match how it writes them"
  exit 1
fi

e2e_log "starting compose project ${COMPOSE_PROJECT_NAME}${*:+ (${*})}"
# --wait blocks until every service healthcheck (postgres / redis / rustfs) is healthy.
# --build so an edit to browser/Dockerfile reaches the running browser; every
# other service pulls a pinned image and has nothing to build.
compose up -d --wait --build "$@"
e2e_log "compose dependencies are up"
