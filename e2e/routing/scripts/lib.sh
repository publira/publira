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

# The hosts the proxy under test is given, one list per app, as the
# PUBLIRA_EDGE_*_HOSTS variables every sample reads. Most of the names follow no
# convention on purpose: a listed host reaches its app whatever it is called,
# so `admin.reader.example.org` is a tenant site here and `studio.example.com`
# a console. The run of spaces in the first list is there to be split. The
# `localhost` names are the ones the Dev Container lists, which the rest of the
# probes use. run-one.sh empties the platform list for its second pass, the
# install that runs no web-platform, so an empty value is kept as it is.
export PUBLIRA_ROUTING_SITE_HOSTS="localhost  reader.example.org admin.reader.example.org"
export PUBLIRA_ROUTING_ADMIN_HOSTS="admin.localhost studio.example.com"
export PUBLIRA_ROUTING_PLATFORM_HOSTS="${PUBLIRA_ROUTING_PLATFORM_HOSTS-platform.localhost operators.example.net}"

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
if [[ "${PUBLIRA_ROUTING_TRUSTED_HOP}" == "1" ]]; then
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

# Ports one run publishes. Only the Dev Container's Traefik answers an API.
if [[ "${PUBLIRA_ROUTING_PROXY}" == "traefik" && "${PUBLIRA_ROUTING_TRUSTED_HOP}" != "1" ]]; then
  PUBLIRA_ROUTING_PUBLISHED_PORTS=("${PUBLIRA_ROUTING_EDGE_PORT}" "${PUBLIRA_ROUTING_TRAEFIK_API_PORT}")
else
  PUBLIRA_ROUTING_PUBLISHED_PORTS=("${PUBLIRA_ROUTING_EDGE_PORT}")
fi

# Router names Traefik loads from infra/proxy/traefik/dynamic/routes.yaml. A
# list with no hosts leaves its router out.
PUBLIRA_ROUTING_ROUTERS=(
  web-host
  web-admin
  api
  images
)
if [[ -n "${PUBLIRA_ROUTING_PLATFORM_HOSTS// /}" ]]; then
  PUBLIRA_ROUTING_ROUTERS+=(web-platform)
fi

# Middleware names from the same file. `strip-trace-context` is attached to
# the `web` entrypoint in the static configuration, so every router on that
# entrypoint refuses requests until the file provider has advertised it;
# waiting for it turns that into one readable message instead of a wall of
# failing probes.
PUBLIRA_ROUTING_MIDDLEWARES=(
  strip-trace-context
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
# than passing the caller's through: X-Forwarded-For is where the server finds
# the client IP it records, and the CSRF origin check reads the other two.
PUBLIRA_ROUTING_FORGED_FORWARDED_HEADERS=(
  "X-Forwarded-For: 203.0.113.9"
  "X-Forwarded-Host: forged.example.test"
  "X-Forwarded-Proto: https"
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

# Arguments after the path are extra `Header: value` lines sent as-is.
http_probe() {
  local method="$1" host="$2" path="$3"
  shift 3
  local header_args=() header
  for header in "$@"; do
    header_args+=(-H "${header}")
  done
  local tmpfile code
  tmpfile="$(mktemp)"
  code="$(
    curl -sS -o "${tmpfile}" -w '%{http_code}' --max-time 5 \
      -X "${method}" \
      -H "Host: ${host}" \
      ${header_args[@]+"${header_args[@]}"} \
      "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}" 2> /dev/null || true
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

# A host in no list: the edge has to answer it with its own 404, whatever the
# path, rather than hand it to any backend.
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

# The headers a backend is promised, on a request that forges all of them.
# `Host` arrives as the browser sent it, `X-Forwarded-Host` and
# `X-Forwarded-Proto` describe this request rather than the caller's claim,
# and `X-Forwarded-For` is the peer address alone — appending would leave the
# forged address in front of the real one, where the backend reads it.
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
  if [[ "${value}" != "http" ]]; then
    routing_fail "${name}: X-Forwarded-Proto '${value}' (want 'http') ${method} ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-for)"
  if [[ -z "${value}" ]]; then
    routing_fail "${name}: X-Forwarded-For is empty (want the peer address) ${method} ${path} body=${body}"
  fi
  if [[ "${value}" == *"203.0.113.9"* ]]; then
    routing_fail "${name}: X-Forwarded-For '${value}' kept the forged address ${method} ${path} body=${body}"
  fi
  if [[ "${value}" == *,* ]]; then
    routing_fail "${name}: X-Forwarded-For '${value}' is a list (want the peer address alone) ${method} ${path} body=${body}"
  fi

  routing_log "ok: ${name} → ${want_backend} with the edge's own forwarded headers"
}

# A request the hop sends to the edge on behalf of a client, naming that
# client's address in X-Forwarded-For and the scheme it used in
# X-Forwarded-Proto, the way a TLS terminator that sets the headers does.
# Prints the status code on the first line and the body after it, like
# http_probe.
hop_probe() {
  local host="$1" path="$2"
  # shellcheck disable=SC2016 # JavaScript, run inside the hop container
  compose exec -T hop node -e '
    const [host, path, forwardedFor] = process.argv.slice(1);
    const request = require("node:http").get(
      { host: "proxy", port: 80, path, headers: { Host: host, "X-Forwarded-For": forwardedFor, "X-Forwarded-Proto": "https" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => { console.log(res.statusCode); console.log(body); });
      }
    );
    request.setTimeout(5000, () => request.destroy(new Error("timed out")));
    request.on("error", (error) => { console.log("000"); console.log(error.message); });
  ' "${host}" "${path}" "${PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS}" 2> /dev/null || true
}

# A request through the trusted hop: the backend has to read the client
# address the hop named, which is the first address in X-Forwarded-For, and
# the scheme it named, which the edge's own plain HTTP would otherwise replace.
# nginx and Caddy forward that address alone; Traefik keeps the hop's header
# and appends the hop's own address after it, which leaves the first one as it
# is.
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

  value="$(json_string_field "${body}" x-forwarded-for)"
  first="${value%%,*}"
  first="${first// /}"
  if [[ "${first}" != "${PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS}" ]]; then
    routing_fail "${name}: X-Forwarded-For '${value}' does not start with the address the trusted hop named (${PUBLIRA_ROUTING_HOP_CLIENT_ADDRESS}) host=${host} GET ${path} body=${body}"
  fi

  value="$(json_string_field "${body}" x-forwarded-proto)"
  if [[ "${value}" != "https" ]]; then
    routing_fail "${name}: X-Forwarded-Proto '${value}' (want 'https', the scheme the trusted hop named) host=${host} GET ${path} body=${body}"
  fi

  routing_log "ok: ${name} → ${want_backend} with the client address and scheme the hop named"
}

# Writes the sample under test to PUBLIRA_ROUTING_PROXY_DIR with its commented
# trusted-proxy setting uncommented as it is written, and the hop's address in
# place of the documentation range. Fails when the sample no longer carries
# the setting in that shape, rather than starting a proxy that trusts nothing
# and blaming the proxy for it.
enable_trusted_hop() {
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
    caddy)
      file=Caddyfile
      uncomment='/^\t# servers {$/,/^\t# }$/ s/^\t# /\t/'
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

# A POST carrying a body of `bytes` bytes and the given `Header: value` lines:
# the backend has to receive all of the body and every header as it was sent.
# A webhook provider signs or authenticates its request with those headers, and
# a body the edge refuses for its size is a delivery the provider retries for
# days and then drops.
assert_webhook_delivered() {
  local name="$1" host="$2" path="$3" want_backend="$4" bytes="$5"
  shift 5
  local header_args=() header field want value
  for header in "$@"; do
    header_args+=(-H "${header}")
  done

  local payload response code body actual_backend actual_path actual_bytes
  payload="$(mktemp)"
  response="$(mktemp)"
  head -c "${bytes}" /dev/zero > "${payload}"
  code="$(
    curl -sS -o "${response}" -w '%{http_code}' --max-time 60 \
      -X POST \
      -H "Host: ${host}" \
      "${header_args[@]}" \
      --data-binary "@${payload}" \
      "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}" 2> /dev/null || true
  )"
  body="$(cat "${response}" 2> /dev/null || true)"
  rm -f "${payload}" "${response}"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} POST ${path} bytes=${bytes} body=${body}"
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

# The edge answers and a listed site host reaches web-host. Readiness for the
# proxies that publish no API of their own.
edge_serves_web_host() {
  local out code body
  out="$(http_probe GET localhost /)"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"
  [[ "${code}" == "200" ]] || return 1
  [[ "$(json_string_field "${body}" backend)" == "web-host" ]]
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
