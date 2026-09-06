#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_e2e_lock

# The backend addresses this run's edge uses. compose.yaml mounts the
# repository's infra/proxy/traefik/dynamic and lays this file over the
# services.yaml in it, so the routers are the ones every environment runs and
# only the addresses are written here — the ports are overridable
# (E2E_WEB_HOST_PORT and the rest) and a file provider substitutes no
# variables of its own.
#
# `localhost` rather than a literal address: web-host is started with
# HOSTNAME=localhost and Next resolves that to ::1 alone, while image-server
# binds every address. Only a name covers both, and it keeps working when
# E2E_WEB_BIND_HOST moves web-host to an IPv4 address instead.
e2e_log "writing traefik services to ${E2E_TRAEFIK_DYNAMIC_DIR}/services.yaml"
cat >"${E2E_TRAEFIK_DYNAMIC_DIR}/services.yaml" <<EOF
http:
  services:
    web-host:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_WEB_HOST_PORT}"
    web-admin:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_WEB_ADMIN_PORT}"
    web-platform:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_WEB_PLATFORM_PORT}"
    api:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_PUBLIC_API_PORT}"
    image-server:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_IMAGE_SERVER_PORT}"
    # This stack starts no admin image server, and no suite asks the edge for
    # an image on an admin host. The address keeps every router in the
    # contract resolvable, which is what stops Traefik logging one as broken.
    admin-image-server:
      loadBalancer:
        servers:
          - url: "http://localhost:${E2E_IMAGE_SERVER_PORT}"
EOF

e2e_log "starting compose project ${COMPOSE_PROJECT_NAME}"
# --wait blocks until every service healthcheck (postgres / redis / rustfs) is healthy.
compose up -d --wait
e2e_log "compose dependencies are up"
