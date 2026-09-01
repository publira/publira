#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_e2e_lock

# Traefik's routers, written per run because the backend ports are overridable
# (E2E_WEB_HOST_PORT / E2E_IMAGE_SERVER_PORT) and a file provider substitutes
# no variables of its own. `/images` outranks the catch-all the same way the
# Dev Container labels order them.
#
# `localhost` rather than a literal address: web-host is started with
# HOSTNAME=localhost and Next resolves that to ::1 alone, while image-server
# binds every address. Only a name covers both, and it keeps working when
# E2E_WEB_BIND_HOST moves web-host to an IPv4 address instead.
e2e_log "writing traefik routers to ${E2E_TRAEFIK_DYNAMIC_DIR}/routes.yaml"
cat >"${E2E_TRAEFIK_DYNAMIC_DIR}/routes.yaml" <<EOF
http:
  routers:
    image-server:
      rule: "PathPrefix(\`/images\`)"
      priority: 110
      entryPoints: [web]
      service: image-server
    web-host:
      rule: "PathPrefix(\`/\`)"
      priority: 1
      entryPoints: [web]
      service: web-host
  services:
    image-server:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_IMAGE_SERVER_PORT}"
    web-host:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_WEB_HOST_PORT}"
EOF

e2e_log "starting compose project ${COMPOSE_PROJECT_NAME}"
# --wait blocks until every service healthcheck (postgres / redis / rustfs) is healthy.
compose up -d --wait
e2e_log "compose dependencies are up"
