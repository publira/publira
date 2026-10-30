#!/usr/bin/env bash
# Shared helpers for the edge routing check.
#
# One run puts a single proxy — Traefik, nginx, or Caddy — in front of
# echo.ts, which answers on the four backend ports, so each probe can assert
# the backend and the path the edge forwarded. The configuration under test is
# always the repository's own, in infra/proxy/<proxy>.
# shellcheck shell=bash disable=SC2034 # read by scripts that source this file

set -euo pipefail

PUBLIRA_ROUTING_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIRA_ROUTING_DIR="$(cd "${PUBLIRA_ROUTING_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PUBLIRA_ROUTING_DIR}/../.." && pwd)"

# Capture before defaults so we can tell "caller set PUBLIRA_ROUTING_RUN_DIR" from unset.
_PUBLIRA_ROUTING_RUN_DIR_FROM_ENV="${PUBLIRA_ROUTING_RUN_DIR-}"

# Which proxy this run exercises. run.sh iterates over every one of them; the
# individual tasks take one at a time.
export PUBLIRA_ROUTING_PROXY="${PUBLIRA_ROUTING_PROXY:-traefik}"
case "${PUBLIRA_ROUTING_PROXY}" in
  traefik | nginx | caddy) ;;
  *)
    printf '[routing] ERROR: unknown PUBLIRA_ROUTING_PROXY %s (traefik, nginx, or caddy)\n' \
      "${PUBLIRA_ROUTING_PROXY}" >&2
    exit 1
    ;;
esac

# Dedicated project name, one per proxy: a run never touches the Dev Container
# stack, and two proxies never tear each other down.
export COMPOSE_PROJECT_NAME="${PUBLIRA_ROUTING_PROJECT_NAME:-publira-routing-${PUBLIRA_ROUTING_PROXY}}"

# Absolute: under the Dev Container overlay the first `-f` is the root
# compose.yaml, so a relative volume would resolve against the repository
# root, not this directory.
export PUBLIRA_ROUTING_ECHO="${PUBLIRA_ROUTING_DIR}/echo.ts"

# Host ports the compose files publish. Offset from the Dev Container forwards
# (3080 / 8080) so a local run can coexist with `task dev`.
export PUBLIRA_ROUTING_EDGE_PORT="${PUBLIRA_ROUTING_EDGE_PORT:-13080}"
# Traefik alone: the insecure API readiness reads routers and middlewares from.
export PUBLIRA_ROUTING_TRAEFIK_API_PORT="${PUBLIRA_ROUTING_TRAEFIK_API_PORT:-18080}"
# Caddy alone: the HTTPS listener of the pass that terminates TLS.
export PUBLIRA_ROUTING_EDGE_TLS_PORT="${PUBLIRA_ROUTING_EDGE_TLS_PORT:-13443}"

# The pass that terminates TLS, which run-one.sh runs for Caddy alone by
# exporting PUBLIRA_ROUTING_TLS=1: the Caddyfile is given every listed host in
# PUBLIRA_EDGE_TLS_HOSTS, the way an install that terminates TLS in it is, and
# every probe goes over HTTPS. No certificate
# authority on the internet reaches the hosts of a test, so this pass lists
# names Caddy issues from its own local CA rather than over ACME: localhost,
# its subdomains, and names under .internal. The probes trust that CA's root,
# which wait-ready.sh copies out of the container.
export PUBLIRA_ROUTING_TLS="${PUBLIRA_ROUTING_TLS:-0}"

# The hosts the proxy under test is given, one list per app and one of the
# tenants' image hosts, as the PUBLIRA_EDGE_*_HOSTS variables every sample
# reads. Most of the names follow no convention on purpose: a listed host
# reaches its app whatever it is called, so `admin.reader.example.org` is a
# tenant site here, `studio.example.com` a console, and `admin.art.example.com`
# an image host. The run of spaces in the first list is there to be split. The
# `localhost` names are the ones the Dev Container lists, which the rest of the
# probes use. run-one.sh empties the platform and image lists for its second
# pass, the install that runs no web-platform and gives no tenant an image
# host, so an empty value is kept as it is.
if [[ "${PUBLIRA_ROUTING_TLS}" == "1" ]]; then
  export PUBLIRA_ROUTING_SITE_HOSTS="localhost reader.internal"
  export PUBLIRA_ROUTING_ADMIN_HOSTS="admin.localhost studio.internal"
  export PUBLIRA_ROUTING_PLATFORM_HOSTS="platform.localhost operators.internal"
  export PUBLIRA_ROUTING_IMAGE_HOSTS="pictures.internal"
  export PUBLIRA_ROUTING_TLS_HOSTS="${PUBLIRA_ROUTING_SITE_HOSTS} ${PUBLIRA_ROUTING_ADMIN_HOSTS} ${PUBLIRA_ROUTING_PLATFORM_HOSTS} ${PUBLIRA_ROUTING_IMAGE_HOSTS}"
else
  export PUBLIRA_ROUTING_SITE_HOSTS="localhost  reader.example.org admin.reader.example.org"
  export PUBLIRA_ROUTING_ADMIN_HOSTS="admin.localhost studio.example.com"
  export PUBLIRA_ROUTING_PLATFORM_HOSTS="${PUBLIRA_ROUTING_PLATFORM_HOSTS-platform.localhost operators.example.net}"
  export PUBLIRA_ROUTING_IMAGE_HOSTS="${PUBLIRA_ROUTING_IMAGE_HOSTS-pictures.example.net admin.art.example.com}"
  export PUBLIRA_ROUTING_TLS_HOSTS=""
fi

# A procedure of the public API, the one namespace the edge forwards under /rpc,
# for the probes that need a request to reach the server.
PUBLIRA_ROUTING_PUBLIC_PROCEDURE="publira.v1.CatalogService/ListPublishedSeries"
# A procedure of the catalog search, which has an allowance of its own.
PUBLIRA_ROUTING_SEARCH_PROCEDURE="publira.v1.CatalogService/SearchPublishedSeries"

# The allowances infra/proxy/README.md lists, as the burst a client may send at
# once and the requests per second that refill it.
PUBLIRA_ROUTING_API_BURST=120
PUBLIRA_ROUTING_API_RATE=20
PUBLIRA_ROUTING_SEARCH_BURST=20
PUBLIRA_ROUTING_SEARCH_RATE=2
PUBLIRA_ROUTING_IMAGES_BURST=600
PUBLIRA_ROUTING_IMAGES_RATE=60

# Logs for one stack run. Concurrent stacks that override ports or
# PUBLIRA_ROUTING_PROJECT_NAME must not share diagnostics: a failure would overwrite
# the other run. When PUBLIRA_ROUTING_RUN_DIR is unset and any of those knobs leave
# the defaults, isolate under a subdirectory named from the project + ports.
# Explicit PUBLIRA_ROUTING_RUN_DIR always wins. The default path e2e/routing/.run/<proxy>
# is kept for the standard single-stack / CI layout so artifacts stay stable.
if [[ -n "${_PUBLIRA_ROUTING_RUN_DIR_FROM_ENV}" ]]; then
  export PUBLIRA_ROUTING_RUN_DIR="${_PUBLIRA_ROUTING_RUN_DIR_FROM_ENV}"
else
  if [[ "${COMPOSE_PROJECT_NAME}" == "publira-routing-${PUBLIRA_ROUTING_PROXY}" ]] &&
    [[ "${PUBLIRA_ROUTING_EDGE_PORT}" == "13080" ]] &&
    [[ "${PUBLIRA_ROUTING_TRAEFIK_API_PORT}" == "18080" ]]; then
    export PUBLIRA_ROUTING_RUN_DIR="${PUBLIRA_ROUTING_DIR}/.run/${PUBLIRA_ROUTING_PROXY}"
  else
    export PUBLIRA_ROUTING_RUN_DIR="${PUBLIRA_ROUTING_DIR}/.run/${COMPOSE_PROJECT_NAME}-edge${PUBLIRA_ROUTING_EDGE_PORT}-api${PUBLIRA_ROUTING_TRAEFIK_API_PORT}"
  fi
fi
unset _PUBLIRA_ROUTING_RUN_DIR_FROM_ENV
RUN_DIR="${PUBLIRA_ROUTING_RUN_DIR}"
LOG_DIR="${RUN_DIR}/logs"

# Exclusive lock for the compose project. up.sh does `compose down` before
# starting, so a second run with the same project name would kill the first.
# The lock file is keyed by project name (the shared Docker resource), not by
# RUN_DIR. flock -n fails immediately; same ports still fail on port_in_use.
PUBLIRA_ROUTING_LOCK_FILE="${PUBLIRA_ROUTING_DIR}/.run/locks/${COMPOSE_PROJECT_NAME}.lock"

PUBLIRA_ROUTING_READY_TIMEOUT_SEC="${PUBLIRA_ROUTING_READY_TIMEOUT_SEC:-60}"
PUBLIRA_ROUTING_READY_INTERVAL_SEC="${PUBLIRA_ROUTING_READY_INTERVAL_SEC:-1}"

# The pass that puts a trusted hop in front of the edge, which run-one.sh
# makes last by exporting PUBLIRA_ROUTING_TRUSTED_HOP=1. The proxy starts from
# a copy of its sample in PUBLIRA_ROUTING_PROXY_DIR whose commented
# trusted-proxy setting enable_trusted_hop has turned on, trusting the hop's
# address alone. The subnet is one Docker does not hand out on its own, so the
# hop network does not collide with the other networks on the daemon; two runs
# at once need a subnet each.
export PUBLIRA_ROUTING_TRUSTED_HOP="${PUBLIRA_ROUTING_TRUSTED_HOP:-0}"
export PUBLIRA_ROUTING_HOP_SUBNET="${PUBLIRA_ROUTING_HOP_SUBNET:-198.18.0.0/24}"
export PUBLIRA_ROUTING_HOP_ADDRESS="${PUBLIRA_ROUTING_HOP_ADDRESS:-198.18.0.10}"
# The pass that sends bursts over the limits infra/proxy/README.md lists,
# which run-one.sh makes last by exporting PUBLIRA_ROUTING_RATE_LIMITS=1 beside
# PUBLIRA_ROUTING_TRUSTED_HOP=1, so that the limits are counted per client
# behind the hop as well. Traefik and nginx limit as their samples stand;
# Caddy's sample carries its limits commented out, which enable_rate_limits
# turns on, and runs on a Caddy built with the module they need.
export PUBLIRA_ROUTING_RATE_LIMITS="${PUBLIRA_ROUTING_RATE_LIMITS:-0}"
# Caddy is given the hop's address in its environment, as enable_trusted_hop
# says, and every other proxy a copy of its sample. Traefik is given it in its
# environment as well, for the routers that keep the reader's region and count
# a client by the address the hop names.
export PUBLIRA_ROUTING_TRUSTED_PROXIES=""
if [[ "${PUBLIRA_ROUTING_TRUSTED_HOP}" == "1" && "${PUBLIRA_ROUTING_PROXY}" != "nginx" ]]; then
  PUBLIRA_ROUTING_TRUSTED_PROXIES="${PUBLIRA_ROUTING_HOP_ADDRESS}/32"
fi
if [[ "${PUBLIRA_ROUTING_TRUSTED_HOP}" == "1" ]] &&
  [[ "${PUBLIRA_ROUTING_PROXY}" != "caddy" || "${PUBLIRA_ROUTING_RATE_LIMITS}" == "1" ]]; then
  export PUBLIRA_ROUTING_PROXY_DIR="${RUN_DIR}/trusted-hop/${PUBLIRA_ROUTING_PROXY}"
else
  # Every other pass mounts the sample from infra/proxy as it stands.
  unset PUBLIRA_ROUTING_PROXY_DIR
fi

# The client address the hop names in X-Forwarded-For, and the documentation
# range each sample's commented setting trusts until an operator fills in
# their hop's addresses.
PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS="198.51.100.7"
PUBLIRA_ROUTING_SAMPLE_TRUSTED_RANGE="192.0.2.0/24"
# The client's region the hop names in X-Forwarded-CountryRegion.
PUBLIRA_ROUTING_HOP_COUNTRY_REGION="JP-13"

# The compose files for this proxy. Traefik is the Dev Container's own edge,
# so its run overlays the very files the Dev Container starts and proves that
# wiring; nginx and Caddy have no environment of their own and get the echo
# backends plus a proxy container. The trusted-hop pass gives every proxy the
# second shape, Traefik from its sample's traefik.yaml, plus the hop.
case "${PUBLIRA_ROUTING_TRUSTED_HOP}:${PUBLIRA_ROUTING_PROXY}" in
  1:traefik)
    PUBLIRA_ROUTING_COMPOSE_FILES=(
      "${PUBLIRA_ROUTING_DIR}/compose.echo.yaml"
      "${PUBLIRA_ROUTING_DIR}/compose.traefik-sample.yaml"
      "${PUBLIRA_ROUTING_DIR}/compose.hop.yaml"
    )
    ;;
  1:*)
    PUBLIRA_ROUTING_COMPOSE_FILES=(
      "${PUBLIRA_ROUTING_DIR}/compose.echo.yaml"
      "${PUBLIRA_ROUTING_DIR}/compose.${PUBLIRA_ROUTING_PROXY}.yaml"
      "${PUBLIRA_ROUTING_DIR}/compose.hop.yaml"
    )
    if [[ "${PUBLIRA_ROUTING_PROXY}" == "caddy" && "${PUBLIRA_ROUTING_RATE_LIMITS}" == "1" ]]; then
      PUBLIRA_ROUTING_COMPOSE_FILES+=("${PUBLIRA_ROUTING_DIR}/compose.caddy-rate-limits.yaml")
    fi
    ;;
  0:traefik)
    # The Dev Container file is an overlay: on its own it leaves the dependency
    # services with nothing but `ports: !reset []`, which is not a valid project.
    PUBLIRA_ROUTING_COMPOSE_FILES=(
      "${REPO_ROOT}/compose.yaml"
      "${REPO_ROOT}/.devcontainer/compose.yaml"
      "${PUBLIRA_ROUTING_DIR}/compose.traefik.yaml"
    )
    ;;
  *)
    PUBLIRA_ROUTING_COMPOSE_FILES=(
      "${PUBLIRA_ROUTING_DIR}/compose.echo.yaml"
      "${PUBLIRA_ROUTING_DIR}/compose.${PUBLIRA_ROUTING_PROXY}.yaml"
    )
    ;;
esac

# Ports one run publishes. Only the Dev Container's Traefik answers an API,
# and only Caddy is run with an HTTPS listener.
if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" && "${PUBLIRA_ROUTING_TRUSTED_HOP}" != "1" ]]; then
  PUBLIRA_ROUTING_PUBLISHED_PORTS=("${PUBLIRA_ROUTING_EDGE_PORT}" "${PUBLIRA_ROUTING_TRAEFIK_API_PORT}")
elif [[ "${PUBLIRA_ROUTING_PROXY}" == "caddy" ]]; then
  PUBLIRA_ROUTING_PUBLISHED_PORTS=("${PUBLIRA_ROUTING_EDGE_PORT}" "${PUBLIRA_ROUTING_EDGE_TLS_PORT}")
else
  PUBLIRA_ROUTING_PUBLISHED_PORTS=("${PUBLIRA_ROUTING_EDGE_PORT}")
fi

# The scheme the probes reach the edge over, which the edge then hands the
# backends in X-Forwarded-Proto, and the root of Caddy's local CA, which the
# probes of the TLS pass trust.
if [[ "${PUBLIRA_ROUTING_TLS}" == "1" ]]; then
  PUBLIRA_ROUTING_EDGE_SCHEME=https
else
  PUBLIRA_ROUTING_EDGE_SCHEME=http
fi
PUBLIRA_ROUTING_CADDY_ROOT="${RUN_DIR}/caddy-root.crt"

# Router names Traefik loads from infra/proxy/traefik/dynamic/routes.yaml. A
# list with no hosts leaves its router out. The image hosts have no router of
# their own: they join the images router.
PUBLIRA_ROUTING_ROUTERS=(
  web-storefront
  web-storefront-search
  web-admin
  rpc
  rpc-search
  rpc-console
  images
  images-console
)
if [[ -n "${PUBLIRA_ROUTING_PLATFORM_HOSTS// /}" ]]; then
  PUBLIRA_ROUTING_ROUTERS+=(web-platform)
fi

# Middleware names from the same file. The first two are attached to the
# `web` entrypoint in the static configuration, the third to every router, and
# the rate limits to the routers of a tenant's site and image hosts, so a
# router refuses requests until the file provider has advertised them;
# waiting for them turns that into one readable message instead of a wall of
# failing probes.
PUBLIRA_ROUTING_MIDDLEWARES=(
  strip-trace-context
  strip-forwarded
  strip-country-region
  rate-limit-api
  rate-limit-search-rpc
  rate-limit-search-page
  rate-limit-images
)

# W3C Trace Context a caller could forge. echo.ts reports each of these
# headers back, so a probe can assert the backend saw none of them.
PUBLIRA_ROUTING_TRACE_CONTEXT_HEADERS=(
  "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  "tracestate: publira=forged"
  "baggage: publira=forged"
)

# Forwarded headers a caller could send ahead of the edge. echo.ts reports
# each of them back, so a probe can assert the edge replaced the value rather
# than passing the caller's through: publira server finds the client IP it
# records in Forwarded, ahead of X-Forwarded-For, the apps find the tenant in
# the host= of Forwarded ahead of X-Forwarded-Host, the CSRF origin check
# reads the same host and X-Forwarded-Proto, and web-storefront hands
# X-Forwarded-CountryRegion to a tenant's Google tag gateway.
PUBLIRA_ROUTING_FORGED_FORWARDED_HEADERS=(
  "Forwarded: for=203.0.113.9"
  "X-Forwarded-For: 203.0.113.9"
  "X-Forwarded-Host: forged.example.test"
  "X-Forwarded-Proto: https"
  "X-Forwarded-CountryRegion: AQ-01"
)

# The headers SendGrid Inbound Parse posts a mail with, its webhook token as
# basic auth among them, and the ones Resend posts an event with, signed by
# Svix. echo.ts reports each back, so a probe can assert the edge passed them
# through as they were: the API server reads the token and the signature from
# them.
PUBLIRA_ROUTING_SENDGRID_HEADERS=(
  "Authorization: Basic aW5ib3VuZDpzZ190b2tlbg=="
  "Content-Type: multipart/form-data; boundary=xYzZY"
)
PUBLIRA_ROUTING_RESEND_HEADERS=(
  "Content-Type: application/json"
  "svix-id: msg_2mN8xQe5Rk3vTqLw"
  "svix-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4="
  "svix-timestamp: 1791195151"
)

routing_log() {
  printf '[routing:%s] %s\n' "${PUBLIRA_ROUTING_PROXY}" "$*"
}

routing_err() {
  printf '[routing:%s] ERROR: %s\n' "${PUBLIRA_ROUTING_PROXY}" "$*" >&2
}

routing_fail() {
  routing_err "$*"
  exit 1
}

compose() {
  local file args=()
  for file in "${PUBLIRA_ROUTING_COMPOSE_FILES[@]}"; do
    args+=(-f "${file}")
  done
  docker compose "${args[@]}" -p "${COMPOSE_PROJECT_NAME}" "$@"
}

ensure_run_dirs() {
  mkdir -p "${LOG_DIR}"
}

# Hold until this shell exits (the FD stays open). Children inherit
# PUBLIRA_ROUTING_LOCK_HELD=1 and skip re-acquire so `bash up.sh` from run-one.sh works.
acquire_routing_lock() {
  if [[ "${PUBLIRA_ROUTING_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  command -v flock > /dev/null 2>&1 ||
    routing_fail "flock is not available; compose project lock cannot be taken"
  mkdir -p "$(dirname "${PUBLIRA_ROUTING_LOCK_FILE}")"
  exec {PUBLIRA_ROUTING_LOCK_FD}> "${PUBLIRA_ROUTING_LOCK_FILE}"
  if ! flock -n "${PUBLIRA_ROUTING_LOCK_FD}"; then
    routing_fail "compose project ${COMPOSE_PROJECT_NAME} is already in use; wait or set PUBLIRA_ROUTING_PROJECT_NAME"
  fi
  export PUBLIRA_ROUTING_LOCK_HELD=1
}

require_port_tool() {
  command -v ss > /dev/null 2>&1 || command -v netstat > /dev/null 2>&1 ||
    routing_fail "neither ss nor netstat is available; port checks cannot run"
}

port_in_use() {
  local port="$1"
  require_port_tool
  ss -ltn 2> /dev/null | grep -qE ":${port}\\b" ||
    netstat -ltn 2> /dev/null | grep -qE ":${port}\\b"
}

# Compact JSON field. Values we emit are identifiers or paths, never quotes.
json_string_field() {
  local json="$1" key="$2"
  printf '%s' "${json}" | sed -n "s/.*\"${key}\":\"\\([^\"]*\\)\".*/\\1/p"
}

# Compact JSON number field.
json_number_field() {
  local json="$1" key="$2"
  printf '%s' "${json}" | sed -n "s/.*\"${key}\":\([0-9][0-9]*\).*/\1/p"
}

# Routers Traefik has currently advertised on the insecure API.
traefik_router_names() {
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${PUBLIRA_ROUTING_TRAEFIK_API_PORT}/api/http/routers" |
    tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'
}

# Middlewares Traefik has currently advertised on the insecure API.
traefik_middleware_names() {
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${PUBLIRA_ROUTING_TRAEFIK_API_PORT}/api/http/middlewares" |
    tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'
}

# The curl arguments that address `path` on the edge for `host`: the
# published port on loopback over plain HTTP, and over HTTPS in the TLS pass
# the host's own name, resolved to loopback, so the TLS handshake names the
# host and the certificate is checked against it.
edge_url_args() {
  local host="$1" path="$2"
  if [[ "${PUBLIRA_ROUTING_TLS}" == "1" ]]; then
    printf '%s\n' --cacert "${PUBLIRA_ROUTING_CADDY_ROOT}" \
      --resolve "${host}:${PUBLIRA_ROUTING_EDGE_TLS_PORT}:127.0.0.1" \
      "https://${host}:${PUBLIRA_ROUTING_EDGE_TLS_PORT}${path}"
  else
    printf '%s\n' "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}"
  fi
}

# Arguments after the path are extra `Header: value` lines sent as-is.
http_probe() {
  local method="$1" host="$2" path="$3"
  shift 3
  local header_args=() header url_args=()
  for header in "$@"; do
    header_args+=(-H "${header}")
  done
  mapfile -t url_args < <(edge_url_args "${host}" "${path}")
  local tmpfile code
  tmpfile="$(mktemp)"
  code="$(
    curl -sS -o "${tmpfile}" -w '%{http_code}' --max-time 5 \
      -X "${method}" \
      -H "Host: ${host}" \
      ${header_args[@]+"${header_args[@]}"} \
      "${url_args[@]}" 2> /dev/null || true
  )"
  printf '%s\n' "${code}"
  cat "${tmpfile}" 2> /dev/null || true
  rm -f "${tmpfile}"
}

# One documented route: method, Host, request path, backend name, forwarded path.
assert_route() {
  local name="$1" method="$2" host="$3" path="$4" want_backend="$5" want_path="$6"
  local out code body actual_backend actual_path

  out="$(http_probe "${method}" "${host}" "${path}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} ${method} ${path} body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  actual_path="$(json_string_field "${body}" path)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} ${method} ${path} body=${body}"
  fi
  if [[ "${actual_path}" != "${want_path}" ]]; then
    routing_fail "${name}: path '${actual_path}' (want '${want_path}') host=${host} ${method} ${path} body=${body}"
  fi

  routing_log "ok: ${name} → ${want_backend}${want_path}"
}

# A request the edge has to answer with its own 404 rather than hand to any
# backend: a host in no list, whatever the path, and a path under /rpc outside
# the public API, whatever the host.
assert_unrouted() {
  local name="$1" method="$2" host="$3" path="$4"
  local out code body actual_backend

  out="$(http_probe "${method}" "${host}" "${path}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  actual_backend="$(json_string_field "${body}" backend)"
  if [[ -n "${actual_backend}" ]]; then
    routing_fail "${name}: reached backend '${actual_backend}' (want none) host=${host} ${method} ${path} body=${body}"
  fi
  if [[ "${code}" != "404" ]]; then
    routing_fail "${name}: HTTP ${code} (want 404 from the edge) host=${host} ${method} ${path} body=${body}"
  fi

  routing_log "ok: ${name} → answered by the edge"
}

# The same route with a forged W3C Trace Context on the request: the edge must
# drop all three headers before the backend sees them, and leave the routing
# and the path alone.
assert_trace_context_stripped() {
  local name="$1" method="$2" host="$3" path="$4" want_backend="$5" want_path="$6"
  local out code body actual_backend actual_path header field value

  out="$(http_probe "${method}" "${host}" "${path}" "${PUBLIRA_ROUTING_TRACE_CONTEXT_HEADERS[@]}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} ${method} ${path} body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  actual_path="$(json_string_field "${body}" path)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} ${method} ${path} body=${body}"
  fi
  if [[ "${actual_path}" != "${want_path}" ]]; then
    routing_fail "${name}: path '${actual_path}' (want '${want_path}') host=${host} ${method} ${path} body=${body}"
  fi

  for header in "${PUBLIRA_ROUTING_TRACE_CONTEXT_HEADERS[@]}"; do
    field="${header%%:*}"
    value="$(json_string_field "${body}" "${field}")"
    if [[ -n "${value}" ]]; then
      routing_fail "${name}: backend saw ${field} '${value}' (want it stripped) host=${host} ${method} ${path} body=${body}"
    fi
  done

  routing_log "ok: ${name} → ${want_backend}${want_path} without trace context"
}

# The header each sample hands the client address over in. publira server
# reads it from either: Traefik sets X-Forwarded-For itself and has no way to
# compose Forwarded, while nginx and Caddy set Forwarded. The other header
# must not arrive at all, or a caller's value would reach the backend in it.
case "${PUBLIRA_ROUTING_PROXY}" in
  traefik)
    PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER=X-Forwarded-For
    PUBLIRA_ROUTING_REMOVED_ADDRESS_HEADER=Forwarded
    ;;
  *)
    PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER=Forwarded
    PUBLIRA_ROUTING_REMOVED_ADDRESS_HEADER=X-Forwarded-For
    ;;
esac

# Sets HANDED_CLIENT_ADDRESSES to the addresses the backend was handed in
# PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER, comma-separated in the order they
# arrived: X-Forwarded-For as it is, and the `for=` of every Forwarded
# element without the quotes and brackets RFC 7239 puts around an IPv6
# address. Fails when PUBLIRA_ROUTING_REMOVED_ADDRESS_HEADER arrived as well.
# A global rather than output, so that a failure here stops the run instead of
# a subshell.
read_handed_client_addresses() {
  local name="$1" body="$2" request="$3"
  local removed value element address
  local -a elements

  removed="$(json_string_field "${body}" "${PUBLIRA_ROUTING_REMOVED_ADDRESS_HEADER,,}")"
  if [[ -n "${removed}" ]]; then
    routing_fail "${name}: backend saw ${PUBLIRA_ROUTING_REMOVED_ADDRESS_HEADER} '${removed}' (want it removed; ${PUBLIRA_ROUTING_PROXY} hands the client address over in ${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER}) ${request} body=${body}"
  fi

  value="$(json_string_field "${body}" "${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER,,}")"
  if [[ "${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER}" == X-Forwarded-For ]]; then
    HANDED_CLIENT_ADDRESSES="${value// /}"
    return
  fi

  HANDED_CLIENT_ADDRESSES=""
  IFS=',' read -ra elements <<< "${value}"
  for element in "${elements[@]}"; do
    if [[ "${element}" != *for=* ]]; then
      routing_fail "${name}: Forwarded '${value}' has an element without for= ${request} body=${body}"
    fi
    address="${element#*for=}"
    address="${address%%;*}"
    address="${address//[\\\"]/}"
    address="${address#[}"
    address="${address%]}"
    HANDED_CLIENT_ADDRESSES+="${HANDED_CLIENT_ADDRESSES:+,}${address// /}"
  done
}

# The headers a backend is promised, on a request that forges all of them.
# `Host` arrives as the browser sent it, `X-Forwarded-Host` and
# `X-Forwarded-Proto` describe this request rather than the caller's claim,
# the client address is the peer address alone, in the header the sample
# hands it over in — appending would pass the forged address on in front of
# the real one — and no region arrives, since no sample looks one up itself.
assert_forwarded_headers() {
  local name="$1" method="$2" host="$3" path="$4" want_backend="$5"
  local out code body actual_backend value

  out="$(http_probe "${method}" "${host}" "${path}" "${PUBLIRA_ROUTING_FORGED_FORWARDED_HEADERS[@]}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} ${method} ${path} body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} ${method} ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" host)"
  if [[ "${value}" != "${host}" ]]; then
    routing_fail "${name}: Host '${value}' (want '${host}' unrewritten) ${method} ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-host)"
  if [[ "${value}" != "${host}" ]]; then
    routing_fail "${name}: X-Forwarded-Host '${value}' (want '${host}') ${method} ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-proto)"
  if [[ "${value}" != "${PUBLIRA_ROUTING_EDGE_SCHEME}" ]]; then
    routing_fail "${name}: X-Forwarded-Proto '${value}' (want '${PUBLIRA_ROUTING_EDGE_SCHEME}') ${method} ${path} body=${body}"
  fi

  read_handed_client_addresses "${name}" "${body}" "${method} ${path}"
  value="${HANDED_CLIENT_ADDRESSES}"
  if [[ -z "${value}" ]]; then
    routing_fail "${name}: ${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER} is empty (want the peer address) ${method} ${path} body=${body}"
  fi
  if [[ "${value}" == *"203.0.113.9"* ]]; then
    routing_fail "${name}: ${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER} '${value}' kept the forged address ${method} ${path} body=${body}"
  fi
  if [[ "${value}" == *,* ]]; then
    routing_fail "${name}: ${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER} '${value}' is a list (want the peer address alone) ${method} ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-countryregion)"
  if [[ -n "${value}" ]]; then
    routing_fail "${name}: backend saw X-Forwarded-CountryRegion '${value}' (want it removed from a caller) ${method} ${path} body=${body}"
  fi

  routing_log "ok: ${name} → ${want_backend} with the edge's own forwarded headers"
}

# A request the hop sends to the edge on behalf of a client, naming that
# client's address in X-Forwarded-For, the scheme it used in
# X-Forwarded-Proto, and its region in X-Forwarded-CountryRegion, the way a
# TLS terminator or a CDN that sets the headers does. It
# names them in Forwarded as well, which no sample passes on even from a hop it
# trusts: each reads the client address from the hop's X-Forwarded-For.
# Prints the status code on the first line and the body after it, like
# http_probe.
hop_probe() {
  local host="$1" path="$2"
  # shellcheck disable=SC2016 # JavaScript, run inside the hop container
  compose exec -T hop node -e '
    const [host, path, forwardedFor, countryRegion] = process.argv.slice(1);
    const headers = {
      Host: host,
      "X-Forwarded-For": forwardedFor,
      "X-Forwarded-Proto": "https",
      "X-Forwarded-CountryRegion": countryRegion,
      Forwarded: `for=${forwardedFor};host=${host};proto=https`,
    };
    const request = require("node:http").get(
      { host: "proxy", port: 80, path, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => { console.log(res.statusCode); console.log(body); });
      }
    );
    request.setTimeout(5000, () => request.destroy(new Error("timed out")));
    request.on("error", (error) => { console.log("000"); console.log(error.message); });
  ' "${host}" "${path}" "${PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS}" "${PUBLIRA_ROUTING_HOP_COUNTRY_REGION}" 2> /dev/null || true
}

# A request through the trusted hop: the backend has to be handed the client
# address the hop named, first in the header the sample hands it over in, and
# the scheme it named, which the edge's own plain HTTP would otherwise replace.
# web-storefront, the one backend that reads it, is handed the region the hop
# named as well.
# nginx and Caddy set Forwarded to that address alone; Traefik keeps the hop's
# X-Forwarded-For and appends the hop's own address after it, which leaves the
# first one as it is.
assert_hop_client_address() {
  local name="$1" host="$2" path="$3" want_backend="$4"
  local out code body actual_backend value first

  out="$(hop_probe "${host}" "${path}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} GET ${path} through the hop body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} GET ${path} through the hop body=${body}"
  fi

  read_handed_client_addresses "${name}" "${body}" "host=${host} GET ${path} through the hop"
  value="${HANDED_CLIENT_ADDRESSES}"
  first="${value%%,*}"
  if [[ "${first}" != "${PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS}" ]]; then
    routing_fail "${name}: ${PUBLIRA_ROUTING_CLIENT_ADDRESS_HEADER} '${value}' does not start with the address the trusted hop named (${PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS}) host=${host} GET ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-proto)"
  if [[ "${value}" != "https" ]]; then
    routing_fail "${name}: X-Forwarded-Proto '${value}' (want 'https', the scheme the trusted hop named) host=${host} GET ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-countryregion)"
  if [[ "${want_backend}" == web-storefront && "${value}" != "${PUBLIRA_ROUTING_HOP_COUNTRY_REGION}" ]]; then
    routing_fail "${name}: X-Forwarded-CountryRegion '${value}' (want '${PUBLIRA_ROUTING_HOP_COUNTRY_REGION}', the region the trusted hop named) host=${host} GET ${path} body=${body}"
  fi

  routing_log "ok: ${name} → ${want_backend} with what the hop named"
}

# Writes the sample under test to PUBLIRA_ROUTING_PROXY_DIR with its commented
# trusted-proxy setting uncommented as it is written, and the hop's address in
# place of the documentation range. Fails when the sample no longer carries
# the setting in that shape, rather than starting a proxy that trusts nothing
# and blaming the proxy for it. The Caddyfile takes the setting from its
# environment instead, so Caddy keeps the sample as it stands and is given the
# hop's address in PUBLIRA_EDGE_TRUSTED_PROXIES; Traefik's routes.yaml reads
# the same variable, beside the copy of traefik.yaml.
enable_trusted_hop() {
  if [[ "${PUBLIRA_ROUTING_PROXY}" == "caddy" ]]; then
    routing_log "trusting ${PUBLIRA_ROUTING_TRUSTED_PROXIES} through PUBLIRA_EDGE_TRUSTED_PROXIES"
    return
  fi

  local sample="${REPO_ROOT}/infra/proxy/${PUBLIRA_ROUTING_PROXY}"
  local dir="${PUBLIRA_ROUTING_PROXY_DIR}" file uncomment

  case "${PUBLIRA_ROUTING_PROXY}" in
    traefik)
      file=traefik.yaml
      uncomment='/^    # forwardedHeaders:$/,/^    #     - / s/^    # /    /'
      ;;
    nginx)
      file=default.conf.template
      uncomment='s/^# \(set_real_ip_from\|real_ip_header\|real_ip_recursive\) /\1 /; s/^    # \(192\.0\.2\.0\/24 1;\)$/    \1/'
      ;;
  esac

  rm -rf "${dir}"
  mkdir -p "$(dirname "${dir}")"
  cp -R "${sample}" "${dir}"
  sed -e "${uncomment}" \
    -e "s|${PUBLIRA_ROUTING_SAMPLE_TRUSTED_RANGE}|${PUBLIRA_ROUTING_HOP_ADDRESS}/32|g" \
    "${sample}/${file}" > "${dir}/${file}"

  if ! grep -Eq "^[^#]*${PUBLIRA_ROUTING_HOP_ADDRESS}/32" "${dir}/${file}"; then
    routing_fail "infra/proxy/${PUBLIRA_ROUTING_PROXY}/${file} no longer carries the commented trusted-proxy setting naming ${PUBLIRA_ROUTING_SAMPLE_TRUSTED_RANGE}"
  fi
  routing_log "enabled the trusted-proxy setting of ${file} for ${PUBLIRA_ROUTING_HOP_ADDRESS}/32"
}

# Writes the Caddyfile to PUBLIRA_ROUTING_PROXY_DIR with its commented
# rate_limit block uncommented as it is written, and fails when the Caddyfile no
# longer carries the block in that shape. Traefik and nginx limit as their
# samples stand, so their copies are the ones enable_trusted_hop wrote.
enable_rate_limits() {
  if [[ "${PUBLIRA_ROUTING_PROXY}" != "caddy" ]]; then
    routing_log "the ${PUBLIRA_ROUTING_PROXY} sample limits requests as it stands"
    return
  fi

  local sample="${REPO_ROOT}/infra/proxy/caddy/Caddyfile"
  local dir="${PUBLIRA_ROUTING_PROXY_DIR}"

  rm -rf "${dir}"
  mkdir -p "${dir}"
  sed -e '/^\t\t# rate_limit {$/,/^\t\t# }$/ s/^\(\t\t\)# \{0,1\}/\1/' \
    "${sample}" > "${dir}/Caddyfile"

  if ! grep -Eq "^"$'\t\t'"rate_limit \{$" "${dir}/Caddyfile"; then
    routing_fail "infra/proxy/caddy/Caddyfile no longer carries the commented rate_limit block"
  fi
  routing_log "enabled the rate_limit block of the Caddyfile"
}

# Sends `count` requests for `path` on `host` as fast as the edge takes them,
# eight at a time, and sets BURST_SERVED and BURST_REFUSED to how many were
# answered 200 and 429, and BURST_SECONDS to how long it took, rounded up. Any
# other answer fails the run. A global rather than output, like
# read_handed_client_addresses.
send_burst() {
  local name="$1" method="$2" host="$3" path="$4" count="$5"
  local args=() i codes code started
  for ((i = 0; i < count; i++)); do
    args+=(-o /dev/null "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}")
  done
  started="$(date +%s%N)"
  codes="$(
    curl -sS --parallel --parallel-max 8 -w '%{http_code}\n' --max-time 30 \
      -X "${method}" -H "Host: ${host}" "${args[@]}" 2> /dev/null || true
  )"
  BURST_SECONDS=$((($(date +%s%N) - started + 999999999) / 1000000000))
  BURST_SERVED=0
  BURST_REFUSED=0
  for code in ${codes}; do
    case "${code}" in
      200) BURST_SERVED=$((BURST_SERVED + 1)) ;;
      429) BURST_REFUSED=$((BURST_REFUSED + 1)) ;;
      *) routing_fail "${name}: HTTP ${code} in a burst (want 200 or 429) host=${host} ${method} ${path}" ;;
    esac
  done
  if ((BURST_SERVED + BURST_REFUSED != count)); then
    routing_fail "${name}: $((BURST_SERVED + BURST_REFUSED)) of ${count} requests answered host=${host} ${method} ${path}"
  fi
}

# The same burst, sent from the hop on behalf of the client `address` names in
# X-Forwarded-For, one request at a time over one connection.
send_hop_burst() {
  local name="$1" host="$2" path="$3" count="$4" address="$5"
  local out code
  # shellcheck disable=SC2016 # JavaScript, run inside the hop container
  out="$(
    compose exec -T hop node -e '
      const [host, path, count, forwardedFor] = process.argv.slice(1);
      const agent = new (require("node:http").Agent)({ keepAlive: true, maxSockets: 1 });
      const get = () => new Promise((resolve) => {
        const request = require("node:http").get(
          { host: "proxy", port: 80, path, agent, headers: { Host: host, "X-Forwarded-For": forwardedFor } },
          (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }
        );
        request.setTimeout(5000, () => request.destroy(new Error("timed out")));
        request.on("error", () => resolve("000"));
      });
      (async () => {
        const started = Date.now();
        const codes = [];
        for (let i = 0; i < Number(count); i++) codes.push(await get());
        console.log(Math.ceil((Date.now() - started) / 1000));
        console.log(codes.join("\n"));
        agent.destroy();
      })();
    ' "${host}" "${path}" "${count}" "${address}" 2> /dev/null || true
  )"
  BURST_SECONDS="$(printf '%s\n' "${out}" | sed -n '1p')"
  BURST_SERVED=0
  BURST_REFUSED=0
  for code in $(printf '%s\n' "${out}" | tail -n +2); do
    case "${code}" in
      200) BURST_SERVED=$((BURST_SERVED + 1)) ;;
      429) BURST_REFUSED=$((BURST_REFUSED + 1)) ;;
      *) routing_fail "${name}: HTTP ${code} in a burst through the hop (want 200 or 429) host=${host} GET ${path}" ;;
    esac
  done
  if ((BURST_SERVED + BURST_REFUSED != count)); then
    routing_fail "${name}: $((BURST_SERVED + BURST_REFUSED)) of ${count} requests answered through the hop host=${host} GET ${path}"
  fi
}

# A burst of twice the allowance from one client: the edge has to serve the
# whole burst and what refilled while it was sent, and no more, and answer the
# rest 429 itself. The bound above admits a second of refill on top of the
# time the burst took, so that a slow runner does not fail it.
check_burst() {
  local name="$1" request="$2" burst="$3" rate="$4"
  local most=$((burst + rate * (BURST_SECONDS + 1) + 1))
  if ((BURST_SERVED < burst)); then
    routing_fail "${name}: ${BURST_SERVED} served (want at least the burst of ${burst}) ${request}"
  fi
  if ((BURST_SERVED > most)); then
    routing_fail "${name}: ${BURST_SERVED} served in ${BURST_SECONDS}s (want at most ${most}: a burst of ${burst} refilled at ${rate}/s) ${request}"
  fi
  if ((BURST_REFUSED == 0)); then
    routing_fail "${name}: nothing refused (want 429 past the burst of ${burst}) ${request}"
  fi
  routing_log "ok: ${name} → ${BURST_SERVED} served, ${BURST_REFUSED} answered 429"
}

assert_rate_limited() {
  local name="$1" method="$2" host="$3" path="$4" burst="$5" rate="$6"
  send_burst "${name}" "${method}" "${host}" "${path}" $((burst * 2))
  check_burst "${name}" "host=${host} ${method} ${path}" "${burst}" "${rate}"
}

assert_hop_rate_limited() {
  local name="$1" host="$2" path="$3" burst="$4" rate="$5" address="$6"
  send_hop_burst "${name}" "${host}" "${path}" $((burst * 2)) "${address}"
  check_burst "${name}" "host=${host} GET ${path} for ${address} through the hop" "${burst}" "${rate}"
}

# A burst the edge has to serve whole: a path no allowance counts, or one on a
# host whose allowances are left to the server.
assert_not_rate_limited() {
  local name="$1" method="$2" host="$3" path="$4" count="$5"
  send_burst "${name}" "${method}" "${host}" "${path}" "${count}"
  if ((BURST_REFUSED != 0)); then
    routing_fail "${name}: ${BURST_REFUSED} of ${count} answered 429 (want none) host=${host} ${method} ${path}"
  fi
  routing_log "ok: ${name} → all ${count} served"
}

# A burst of one allowance, sent right after a burst that spent it on another
# host the allowance counts: the edge has to serve only what refilled since,
# not the burst of an allowance of its own.
assert_allowance_shared() {
  local name="$1" method="$2" host="$3" path="$4" burst="$5" rate="$6"
  local most
  send_burst "${name}" "${method}" "${host}" "${path}" "${burst}"
  most=$((rate * (BURST_SECONDS + 1) + 1))
  if ((BURST_SERVED > most)); then
    routing_fail "${name}: ${BURST_SERVED} of ${burst} served in ${BURST_SECONDS}s (want at most ${most}: the allowance is spent and refills at ${rate}/s) host=${host} ${method} ${path}"
  fi
  routing_log "ok: ${name} → ${BURST_SERVED} of ${burst} served, the rest answered 429"
}

# The same through the hop, for the client `address` names.
assert_hop_served() {
  local name="$1" host="$2" path="$3" address="$4"
  send_hop_burst "${name}" "${host}" "${path}" 1 "${address}"
  if ((BURST_SERVED != 1)); then
    routing_fail "${name}: answered 429 (want 200: ${address} has its own allowance) host=${host} GET ${path} through the hop"
  fi
  routing_log "ok: ${name} → served"
}

# A POST carrying a body of `bytes` bytes and the given `Header: value` lines:
# the backend has to receive all of the body and every header as it was sent.
# A webhook provider signs or authenticates its request with those headers, and
# a body the edge refuses for its size is a delivery the provider retries for
# days and then drops.
assert_webhook_delivered() {
  assert_upload_delivered "$1" "$2" "$3" "$4" "$5" 0 "${@:6}"
}

# The same POST, sent no faster than spreads the body over `seconds` seconds,
# the way an upload leaves a slow uplink, or as fast as it goes when `seconds`
# is 0. An edge that limits how long a request may take to arrive cuts a slow
# body off part way, which a body sent at full speed never shows.
assert_upload_delivered() {
  local name="$1" host="$2" path="$3" want_backend="$4" bytes="$5" seconds="$6"
  shift 6
  local header_args=() header field want value
  for header in "$@"; do
    header_args+=(-H "${header}")
  done
  # curl averages its rate over the whole transfer, so the body cannot arrive
  # sooner than `seconds`; the deadline leaves the edge a minute on top.
  local rate_args=() max_time=60
  if ((seconds > 0)); then
    rate_args=(--limit-rate "$((bytes / seconds))")
    max_time=$((seconds + 60))
  fi

  local payload response code body actual_backend actual_path actual_bytes
  payload="$(mktemp)"
  response="$(mktemp)"
  head -c "${bytes}" /dev/zero > "${payload}"
  code="$(
    curl -sS -o "${response}" -w '%{http_code}' --max-time "${max_time}" \
      ${rate_args[@]+"${rate_args[@]}"} \
      -X POST \
      -H "Host: ${host}" \
      ${header_args[@]+"${header_args[@]}"} \
      --data-binary "@${payload}" \
      "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}" 2> /dev/null || true
  )"
  body="$(cat "${response}" 2> /dev/null || true)"
  rm -f "${payload}" "${response}"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} POST ${path} bytes=${bytes} seconds=${seconds} body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  actual_path="$(json_string_field "${body}" path)"
  actual_bytes="$(json_number_field "${body}" bytes)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} POST ${path} body=${body}"
  fi
  if [[ "${actual_path}" != "${path}" ]]; then
    routing_fail "${name}: path '${actual_path}' (want '${path}') host=${host} POST ${path} body=${body}"
  fi
  if [[ "${actual_bytes}" != "${bytes}" ]]; then
    routing_fail "${name}: backend received ${actual_bytes:-no} bytes (want ${bytes}) host=${host} POST ${path} body=${body}"
  fi

  for header in "$@"; do
    field="$(printf '%s' "${header%%:*}" | tr '[:upper:]' '[:lower:]')"
    want="${header#*: }"
    value="$(json_string_field "${body}" "${field}")"
    if [[ "${value}" != "${want}" ]]; then
      routing_fail "${name}: backend saw ${field} '${value}' (want '${want}') host=${host} POST ${path} body=${body}"
    fi
  done

  routing_log "ok: ${name} → ${want_backend}${path} with ${bytes} bytes and its headers intact"
}

# Copies the root of Caddy's local CA out of the proxy container, once Caddy
# has created it to issue the first certificate the TLS pass lists.
fetch_caddy_root() {
  [[ -s "${PUBLIRA_ROUTING_CADDY_ROOT}" ]] && return 0
  compose exec -T proxy cat /data/caddy/pki/authorities/local/root.crt \
    > "${PUBLIRA_ROUTING_CADDY_ROOT}.tmp" 2> /dev/null &&
    mv "${PUBLIRA_ROUTING_CADDY_ROOT}.tmp" "${PUBLIRA_ROUTING_CADDY_ROOT}"
}

# The edge answers and a listed site host reaches web-storefront. Readiness for
# the proxies that publish no API of their own.
edge_serves_web_storefront() {
  local out code body
  if [[ "${PUBLIRA_ROUTING_TLS}" == "1" ]]; then
    fetch_caddy_root || return 1
  fi
  out="$(http_probe GET localhost /)"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"
  [[ "${code}" == "200" ]] || return 1
  [[ "$(json_string_field "${body}" backend)" == "web-storefront" ]]
}

collect_diagnostics() {
  routing_err "collecting diagnostics into ${LOG_DIR}"
  mkdir -p "${LOG_DIR}"

  compose ps > "${LOG_DIR}/compose-ps.log" 2>&1 || true
  compose logs --no-color --tail 200 > "${LOG_DIR}/compose.log" 2>&1 || true
  if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" && "${PUBLIRA_ROUTING_TRUSTED_HOP}" != "1" ]]; then
    curl -fsS --max-time 3 \
      "http://127.0.0.1:${PUBLIRA_ROUTING_TRAEFIK_API_PORT}/api/http/routers" \
      > "${LOG_DIR}/traefik-routers.json" 2>&1 || true
    curl -fsS --max-time 3 \
      "http://127.0.0.1:${PUBLIRA_ROUTING_TRAEFIK_API_PORT}/api/http/middlewares" \
      > "${LOG_DIR}/traefik-middlewares.json" 2>&1 || true
  fi

  local f
  for f in "${LOG_DIR}"/*.log "${LOG_DIR}"/*.json; do
    [[ -f "${f}" ]] || continue
    routing_err "--- tail $(basename "${f}") ---"
    tail -n 40 "${f}" >&2 || true
  done
}
