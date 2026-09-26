#!/usr/bin/env bash
# Shared, deliberately small state layer for isolated local development profiles.
# shellcheck shell=bash disable=SC2034 # read by scripts that source this file

set -euo pipefail

DEV_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${DEV_ENV_DIR}/../.." && pwd)"
DEV_ENV_HOME="${PUBLIRA_DEV_ENV_HOME:-${HOME}/.publira/dev-env}"
DEV_ENV_PROFILES_DIR="${DEV_ENV_HOME}/profiles"
DEV_ENV_SELECTION_FILE="${REPO_ROOT}/.publira-dev-env"
DEV_ENV_SLOT_MIN=1
DEV_ENV_SLOT_MAX=15
# The shape dev_env_write_profile writes. A load refuses any other, because a
# profile is local state nothing in the repository reads and recreating one
# costs less than keeping every superseded shape loadable. Raise it in the same
# commit as a change to what a profile holds.
DEV_ENV_PROFILE_VERSION=2

dev_env_error() {
  printf 'dev-env: %s\n' "$*" >&2
}

dev_env_die() {
  dev_env_error "$*"
  exit 1
}

# Fails on the first of the named commands that is not installed, naming it.
# A step that cannot be undone looks its tools up through this before it runs,
# so a sequence of such steps stops while everything it would remove is still
# there and can be removed by running the command again.
dev_env_require_commands() {
  local required
  for required in "$@"; do
    command -v "${required}" > /dev/null 2>&1 || dev_env_die "required command not found: ${required}"
  done
}

dev_env_identifier_is_valid() {
  [[ "$1" =~ ^[a-z][a-z0-9-]{0,31}$ ]]
}

# Whether a value names one of the Valkey logical databases a profile may hold.
# Database 0 is the shared development environment's own, so it is outside the
# range on purpose: a profile that took it would flush that environment on
# destroy.
dev_env_slot_is_valid() {
  # The digits are counted before they are compared: bash arithmetic is done in
  # intmax_t, and a decimal past its width wraps rather than failing, so 2^64+1
  # would otherwise pass as slot 1.
  [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && (($1 >= DEV_ENV_SLOT_MIN && $1 <= DEV_ENV_SLOT_MAX))
}

dev_env_profile_path() {
  printf '%s/%s.env\n' "${DEV_ENV_PROFILES_DIR}" "$1"
}

dev_env_ensure_home() {
  mkdir -p "${DEV_ENV_PROFILES_DIR}"
  chmod 700 "${DEV_ENV_HOME}" "${DEV_ENV_PROFILES_DIR}"
}

dev_env_validate_name() {
  local name="$1"
  if ! dev_env_identifier_is_valid "${name}"; then
    dev_env_die "profile name must match [a-z][a-z0-9-]{0,31}: ${name}"
  fi
}

dev_env_read_selection() {
  [[ -f "${DEV_ENV_SELECTION_FILE}" ]] || return 1
  local selected
  selected="$(< "${DEV_ENV_SELECTION_FILE}")"
  dev_env_identifier_is_valid "${selected}" || return 1
  printf '%s\n' "${selected}"
}

dev_env_select() {
  local name="$1"
  dev_env_validate_name "${name}"
  [[ -f "$(dev_env_profile_path "${name}")" ]] || dev_env_die "profile does not exist: ${name}"
  printf '%s\n' "${name}" > "${DEV_ENV_SELECTION_FILE}"
}

dev_env_profile_value() {
  local profile_path="$1"
  local wanted_key="$2"
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "${key}" == "${wanted_key}" ]]; then
      printf '%s\n' "${value}"
      return 0
    fi
  done < "${profile_path}"
  return 1
}

dev_env_load_required_profile_value() {
  local profile_path="$1"
  local key="$2"
  local value
  if ! value="$(dev_env_profile_value "${profile_path}" "${key}")"; then
    dev_env_die "profile is missing ${key}: ${profile_path}"
  fi
  if [[ -z "${value}" ]]; then
    dev_env_die "profile has an empty ${key}: ${profile_path}"
  fi
  printf -v "${key}" '%s' "${value}"
  export "${key?}"
}

dev_env_profile_in_use() {
  local name="$1"
  local worktree selection
  while IFS= read -r worktree; do
    selection="${worktree}/.publira-dev-env"
    [[ -f "${selection}" ]] || continue
    if [[ "$(< "${selection}")" == "${name}" ]]; then
      printf '%s\n' "${worktree}"
    fi
  done < <(git -C "${REPO_ROOT}" worktree list --porcelain | awk '/^worktree / {print $2}')
}

# Holds an exclusive lock on the profile table until dev_env_unlock_profiles or
# until this shell exits, however it exits. Python stands in for flock(1), which
# macOS lacks, and descriptor 9 is fixed because macOS's bash 3.2 cannot allocate one.
dev_env_lock_profiles() {
  local lock_path="${DEV_ENV_HOME}/profiles.lock"
  dev_env_require_commands python3
  exec 9>> "${lock_path}"
  python3 -c 'import fcntl, sys; fcntl.flock(int(sys.argv[1]), fcntl.LOCK_EX)' 9 ||
    dev_env_die "cannot lock ${lock_path}"
}

dev_env_unlock_profiles() {
  exec 9>&-
}

# Prints the lowest slot no profile holds. Prints nothing and fails when every
# one is held, rather than dying: a die here would end only the command
# substitution that called it, and the caller would go on to write a profile
# with no slot at all.
dev_env_next_slot() {
  local used_slots=() profile slot
  shopt -s nullglob
  for profile in "${DEV_ENV_PROFILES_DIR}"/*.env; do
    slot="$(dev_env_profile_value "${profile}" DEV_ENV_SLOT || true)"
    [[ "${slot}" =~ ^[0-9]+$ ]] && used_slots+=("${slot}")
  done
  shopt -u nullglob

  for ((slot = DEV_ENV_SLOT_MIN; slot <= DEV_ENV_SLOT_MAX; slot += 1)); do
    local used=false
    local candidate
    for candidate in "${used_slots[@]:-}"; do
      if [[ "${candidate}" == "${slot}" ]]; then
        used=true
        break
      fi
    done
    if [[ "${used}" == false ]]; then
      printf '%s\n' "${slot}"
      return 0
    fi
  done
  return 1
}

# Prints "<name> (slot <n>)" for every profile that holds a slot, in slot order,
# so that a developer who cannot get one is told what to destroy.
dev_env_slot_holders() {
  local profile name slot
  shopt -s nullglob
  for profile in "${DEV_ENV_PROFILES_DIR}"/*.env; do
    slot="$(dev_env_profile_value "${profile}" DEV_ENV_SLOT || true)"
    [[ "${slot}" =~ ^[0-9]+$ ]] || continue
    name="$(dev_env_profile_value "${profile}" DEV_ENV_NAME || true)"
    printf '%s\t%s (slot %s)\n' "${slot}" "${name:-${profile##*/}}" "${slot}"
  done | sort -n | cut -f2-
  shopt -u nullglob
}

dev_env_random_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

# Secret decryption for the SMTP password a profile's worker reads. A worker
# started without keys reports an unusable secret manager, and every mail
# handler stops there before it reaches Mailpit, so the mailbox stays empty while
# the event retries until it is dead. The seeded password is not an encrypted
# envelope and the manager hands such a value back unchanged, so the key itself
# is never used — one only has to exist. 32 bytes, base64url, as the parser
# requires.
#
# Development-only, and deliberately the same for every profile rather than a
# per-profile random value: nothing a profile stores is encrypted with it, so a
# profile-scoped key would only make older profiles fail to decrypt what a newer
# one wrote.
DEV_ENV_SECRET_ENCRYPTION_PRIMARY_KEY_ID='dev'
DEV_ENV_SECRET_ENCRYPTION_KEYS="${DEV_ENV_SECRET_ENCRYPTION_PRIMARY_KEY_ID}:ZGV2LW9ubHktaW5zZWN1cmUtc2VjcmV0LWtleS0zMmI"

# Prints the host:port of a URL such as postgres://user:pass@host:5432/db?x,
# redis://host:6379/1, or http://host:9000. A URL without a port gets the
# default passed as the second argument; a URL without a host, or with a port
# that is empty or not a number in 1-65535, is rejected so that a malformed
# value fails here rather than in every psql and server start that follows.
dev_env_url_authority() {
  local url="$1" default_port="$2" authority host port
  authority="${url#*://}"
  authority="${authority%%/*}"
  authority="${authority%%\?*}"
  authority="${authority##*@}"
  if [[ "${authority}" == *:* ]]; then
    host="${authority%:*}"
    port="${authority##*:}"
    [[ "${port}" =~ ^[0-9]{1,5}$ ]] || return 1
    ((port >= 1 && port <= 65535)) || return 1
  else
    host="${authority}"
    port="${default_port}"
  fi
  [[ -n "${host}" ]] || return 1
  printf '%s:%s\n' "${host}" "${port}"
}

# The dependency services are reachable by their Compose service name inside
# the Dev Container and on loopback on the host, where compose.yaml publishes
# them. The shared development variables already carry the right host for the
# place a shell runs in (the Dev Container exports the service names, the host
# instructions in README.md export loopback), so a profile takes its hosts
# from them and falls back to the service names when none is exported.
dev_env_postgres_authority() {
  if [[ -n "${PUBLIRA_DB_URL:-}" ]]; then
    dev_env_url_authority "${PUBLIRA_DB_URL}" 5432 ||
      dev_env_die "cannot derive the PostgreSQL host from PUBLIRA_DB_URL: ${PUBLIRA_DB_URL}"
    return 0
  fi
  printf 'db:5432\n'
}

dev_env_redis_authority() {
  if [[ -n "${PUBLIRA_REDIS_URL:-}" ]]; then
    dev_env_url_authority "${PUBLIRA_REDIS_URL}" 6379 ||
      dev_env_die "cannot derive the Valkey host from PUBLIRA_REDIS_URL: ${PUBLIRA_REDIS_URL}"
    return 0
  fi
  printf 'redis:6379\n'
}

# The Redis-protocol client that talks to a profile's Valkey server. The Dev
# Container image carries Valkey's own client, while a shell on the host more
# often has the one a Redis installation brings; both speak what the server
# answers, so whichever is present is used. Prints nothing and fails when
# neither is, leaving the message to the caller, which knows what it wanted the
# client for.
dev_env_redis_cli() {
  local client
  for client in valkey-cli redis-cli; do
    if command -v "${client}" > /dev/null 2>&1; then
      printf '%s\n' "${client}"
      return 0
    fi
  done
  return 1
}

dev_env_s3_endpoint() {
  printf '%s\n' "${PUBLIRA_S3_ENDPOINT:-http://rustfs:9000}"
}

# Removes a bucket with everything in it, and reports a bucket that is already
# gone as the success it is: `rb --force` lists the objects before it deletes
# the bucket, so it fails on ListObjectsV2 rather than finding nothing to do.
# Any other failure is passed on with the message the CLI printed.
dev_env_remove_bucket() {
  local bucket="$1" endpoint="${2:-}" endpoint_args=() output status=0
  [[ -z "${endpoint}" ]] || endpoint_args=(--endpoint-url "${endpoint}")
  output="$(aws "${endpoint_args[@]}" s3 rb "s3://${bucket}" --force 2>&1)" || status=$?
  if ((status == 0)) || [[ "${output}" == *NoSuchBucket* ]]; then
    return 0
  fi
  printf '%s\n' "${output}" >&2
  return "${status}"
}

# Administrator connection for creating and dropping a profile's database.
# A loaded profile's PUBLIRA_DB_URL is the superuser URL of that database, so
# the maintenance database on the same server is reached by swapping the path;
# PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL overrides it for a server with other
# credentials.
dev_env_postgres_admin_url() {
  if [[ -n "${PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL:-}" ]]; then
    printf '%s\n' "${PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL}"
    return 0
  fi
  local authority
  authority="$(dev_env_url_authority "${PUBLIRA_DB_URL}" 5432)" ||
    dev_env_die "cannot derive the PostgreSQL host from PUBLIRA_DB_URL: ${PUBLIRA_DB_URL}"
  printf 'postgres://postgres:password@%s/postgres?sslmode=disable\n' "${authority}"
}

dev_env_write_profile() {
  local name="$1"
  local slot="$2"
  local profile_path tmp_path port_base postgres redis
  # A profile written with no slot would carry PUBLIRA_REDIS_URL=redis://host/,
  # a URL that resolves to database 0.
  dev_env_slot_is_valid "${slot}" ||
    dev_env_die "profile ${name} was given the slot '${slot}', outside ${DEV_ENV_SLOT_MIN}-${DEV_ENV_SLOT_MAX}"
  profile_path="$(dev_env_profile_path "${name}")"
  tmp_path="${profile_path}.tmp.$$"
  port_base=$((13000 + slot * 100))
  postgres="$(dev_env_postgres_authority)"
  redis="$(dev_env_redis_authority)"

  umask 077
  {
    printf 'DEV_ENV_PROFILE_VERSION=%s\n' "${DEV_ENV_PROFILE_VERSION}"
    printf 'DEV_ENV_NAME=%s\n' "${name}"
    printf 'DEV_ENV_SLOT=%s\n' "${slot}"
    printf 'DEV_ENV_OWNER_WORKTREE=%s\n' "${REPO_ROOT}"
    printf 'PUBLIRA_DB_URL=postgres://postgres:password@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_PUBLIC_DB_URL=postgres://publira_public:publicpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_ADMIN_DB_URL=postgres://publira_admin:adminpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_PLATFORM_DB_URL=postgres://publira_platform:platformpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_WORKER_DB_URL=postgres://publira_outbox:outboxpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_CONTENT_STATS_DB_URL=postgres://publira_content_stats:contentstatspass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_TICKER_DB_URL=postgres://publira_ticker:tickerpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_REDIS_URL=redis://%s/%s\n' "${redis}" "${slot}"
    printf 'PUBLIRA_S3_BUCKET=publira-%s\n' "${name}"
    printf 'PUBLIRA_S3_ENDPOINT=%s\n' "$(dev_env_s3_endpoint)"
    printf 'PUBLIRA_S3_FORCE_PATH_STYLE=%s\n' "${PUBLIRA_S3_FORCE_PATH_STYLE:-true}"
    printf 'PUBLIRA_COOKIE_SUFFIX=-%s\n' "${name}"
    printf 'PUBLIRA_AUTH_SECRET=%s\n' "$(dev_env_random_secret)"
    printf 'PUBLIRA_AUTH_JWT_SECRET=%s\n' "$(dev_env_random_secret)"
    printf 'PUBLIRA_REVALIDATE_TOKEN=%s\n' "$(dev_env_random_secret)"
    printf 'PUBLIRA_WEB_HOST_PORT=%s\n' "${port_base}"
    printf 'PUBLIRA_WEB_ADMIN_PORT=%s\n' "$((port_base + 1))"
    printf 'PUBLIRA_WEB_PLATFORM_PORT=%s\n' "$((port_base + 2))"
    printf 'PUBLIRA_PUBLIC_API_PORT=%s\n' "$((port_base + 10))"
    printf 'PUBLIRA_PUBLIC_API_GRPC_PORT=%s\n' "$((port_base + 11))"
    printf 'PUBLIRA_EMAIL_RENDERER_PORT=%s\n' "$((port_base + 30))"
    printf 'PUBLIRA_WORKER_PORT=%s\n' "$((port_base + 40))"
    # The profile's front door: a browser asks for `/images…` and `/api…` on
    # the origin the page it is reading came from, and only the edge knows
    # both paths are the server's. The platform console URL below is therefore
    # the edge's.
    printf 'PUBLIRA_EDGE_PORT=%s\n' "$((port_base + 50))"
    printf 'PUBLIRA_GRPC_URL=http://127.0.0.1:%s\n' "$((port_base + 11))"
    printf 'PUBLIRA_WEB_HOST_INTERNAL_URL=http://127.0.0.1:%s\n' "${port_base}"
    printf 'PUBLIRA_WEB_ADMIN_INTERNAL_URL=http://127.0.0.1:%s\n' "$((port_base + 1))"
    printf 'PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://127.0.0.1:%s\n' "$((port_base + 2))"
    printf 'PUBLIRA_PLATFORM_APP_URL=http://platform.localhost:%s\n' "$((port_base + 50))"
    printf 'PUBLIRA_EMAIL_RENDERER_URL=http://127.0.0.1:%s\n' "$((port_base + 30))"
  } > "${tmp_path}"
  chmod 600 "${tmp_path}"
  mv "${tmp_path}" "${profile_path}"
}

# The identity and the resources a profile names: its database, its Valkey
# logical database, and its bucket. Every shape this script has written has
# named them by these keys, so a destroy reads a profile through this and goes
# on removing what an outdated one holds after dev_env_load_profile refuses it.
dev_env_load_profile_resources() {
  local name="$1"
  local profile_path key
  profile_path="$(dev_env_profile_path "${name}")"
  [[ -f "${profile_path}" ]] || dev_env_die "profile does not exist: ${name}"

  dev_env_load_required_profile_value "${profile_path}" DEV_ENV_NAME
  dev_env_load_required_profile_value "${profile_path}" DEV_ENV_SLOT
  [[ "${DEV_ENV_NAME}" == "${name}" ]] || dev_env_die "profile name mismatch: ${profile_path}"
  dev_env_identifier_is_valid "${DEV_ENV_NAME}" || dev_env_die "invalid profile name in ${profile_path}"
  dev_env_slot_is_valid "${DEV_ENV_SLOT}" || dev_env_die "invalid Valkey slot in ${profile_path}"

  for key in PUBLIRA_DB_URL PUBLIRA_REDIS_URL PUBLIRA_S3_BUCKET PUBLIRA_S3_ENDPOINT; do
    dev_env_load_required_profile_value "${profile_path}" "${key}"
  done
}

dev_env_load_profile() {
  local name="$1"
  local profile_path version key
  profile_path="$(dev_env_profile_path "${name}")"
  [[ -f "${profile_path}" ]] || dev_env_die "profile does not exist: ${name}"

  # The version is read before any other key so that a profile written in an
  # earlier shape is named as the outdated thing it is, rather than by whichever
  # key that shape happens to be missing.
  version="$(dev_env_profile_value "${profile_path}" DEV_ENV_PROFILE_VERSION || true)"
  if [[ "${version}" != "${DEV_ENV_PROFILE_VERSION}" ]]; then
    dev_env_error "profile ${name} was written in an earlier shape: ${profile_path}"
    dev_env_die "create it again: task dev-env:destroy NAME=${name} && task dev-env:create NAME=${name} && task dev-env:init"
  fi

  dev_env_load_profile_resources "${name}"
  dev_env_load_required_profile_value "${profile_path}" DEV_ENV_OWNER_WORKTREE

  for key in \
    PUBLIRA_PUBLIC_DB_URL PUBLIRA_ADMIN_DB_URL PUBLIRA_PLATFORM_DB_URL \
    PUBLIRA_WORKER_DB_URL PUBLIRA_CONTENT_STATS_DB_URL PUBLIRA_TICKER_DB_URL \
    PUBLIRA_S3_FORCE_PATH_STYLE PUBLIRA_COOKIE_SUFFIX PUBLIRA_AUTH_SECRET \
    PUBLIRA_AUTH_JWT_SECRET PUBLIRA_REVALIDATE_TOKEN PUBLIRA_WEB_HOST_PORT \
    PUBLIRA_WEB_ADMIN_PORT PUBLIRA_WEB_PLATFORM_PORT PUBLIRA_PUBLIC_API_PORT \
    PUBLIRA_PUBLIC_API_GRPC_PORT \
    PUBLIRA_EMAIL_RENDERER_PORT PUBLIRA_WORKER_PORT PUBLIRA_EDGE_PORT \
    PUBLIRA_GRPC_URL \
    PUBLIRA_WEB_HOST_INTERNAL_URL PUBLIRA_WEB_ADMIN_INTERNAL_URL PUBLIRA_WEB_PLATFORM_INTERNAL_URL \
    PUBLIRA_PLATFORM_APP_URL PUBLIRA_EMAIL_RENDERER_URL; do
    dev_env_load_required_profile_value "${profile_path}" "${key}"
  done

  # @publira/next-cache-handlers reads the Redis and the revalidation token the
  # server shares with the web apps under names of its own.
  export PNCH_REDIS_URL="${PUBLIRA_REDIS_URL}"
  export PNCH_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}"
}

dev_env_selected_profile() {
  local selected
  selected="$(dev_env_read_selection)" || dev_env_die "no profile is selected; run: task dev-env:create NAME=<name>"
  printf '%s\n' "${selected}"
}

# Seconds a stopped process group is given to exit after SIGTERM, and then
# after the SIGKILL that follows it.
DEV_ENV_STOP_TERM_SECONDS=10
DEV_ENV_STOP_KILL_SECONDS=5

dev_env_profile_run_dir() {
  printf '%s/runs/%s\n' "${DEV_ENV_HOME}" "$1"
}

# Whether a profile still has processes of its own. The run directory outlives
# them: a stop removes the pid file of every service it ended, but the logs of
# that run are kept for reading afterwards, so the directory itself says only
# that the profile was started once. A pid file exists for as long as the
# processes it names do, which is the question both start and destroy ask. The
# edge answers it with the services file it is given, which a stop removes once
# the container is down.
dev_env_profile_has_running_processes() {
  compgen -G "$(dev_env_profile_run_dir "$1")/*.pid" > /dev/null ||
    [[ -f "$(dev_env_edge_services_file "$1")" ]]
}

# The reverse proxy in front of one profile's processes. A profile without one
# serves no image: `/images…` is the server's, and a browser asks for it on the
# origin the page it is reading came from, so something has to stand in front
# of both. It is a container rather than a seventh process because the
# routing every environment runs is Traefik configuration, and answering the
# same contract in a second implementation is how the two drift apart.
DEV_ENV_EDGE_COMPOSE_FILE="${DEV_ENV_DIR}/compose.yaml"

dev_env_edge_project() {
  printf 'publira-dev-env-%s\n' "$1"
}

# Where the backend addresses of one profile's edge are written. It is also
# what says the edge is up: it is written just before the container starts and
# removed once it is down.
dev_env_edge_services_file() {
  printf '%s/edge-services.yaml\n' "$(dev_env_profile_run_dir "$1")"
}

# Starts the edge of a loaded profile, replacing the committed backend
# addresses with this profile's ports. The routing itself — routes.yaml, the
# whole of `infra/proxy/README.md`'s contract — is mounted as it stands.
dev_env_start_edge() {
  local name="$1" services_file
  dev_env_require_commands docker
  services_file="$(dev_env_edge_services_file "${name}")"
  cat > "${services_file}" << EOF
# Written by scripts/dev-env.sh for profile ${name}. Edits are overwritten by
# the next start.
http:
  services:
    web-host:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${PUBLIRA_WEB_HOST_PORT}"
    web-admin:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${PUBLIRA_WEB_ADMIN_PORT}"
    web-platform:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${PUBLIRA_WEB_PLATFORM_PORT}"
    api:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${PUBLIRA_PUBLIC_API_PORT}"
EOF
  COMPOSE_PROJECT_NAME="$(dev_env_edge_project "${name}")" \
  PUBLIRA_DEV_ENV_EDGE_SERVICES_FILE="${services_file}" \
    docker compose --file "${DEV_ENV_EDGE_COMPOSE_FILE}" up --detach --wait
}

# Ends the edge of a profile and reports whether it is gone. `down` takes the
# project by name, so a stop needs none of the settings a start reads and works
# for a profile whose file has already been edited or removed.
dev_env_stop_edge() {
  local name="$1" services_file
  services_file="$(dev_env_edge_services_file "${name}")"
  [[ -f "${services_file}" ]] || return 0
  if ! command -v docker > /dev/null 2>&1; then
    dev_env_error "docker is not installed; the edge of profile ${name} is still running"
    return 1
  fi
  if ! docker compose --project-name "$(dev_env_edge_project "${name}")" down; then
    dev_env_error "the edge of profile ${name} was not stopped"
    return 1
  fi
  rm -f "${services_file}"
}

# What a service inherits from the shell that starts it: where its tools are,
# where they keep their own state, and the locale.
DEV_ENV_BASE_VARIABLES=(
  PATH HOME LANG LC_ALL TZ TMPDIR PNPM_HOME
  XDG_CACHE_HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME
)

# Starts one service of a profile, detached, and records the pid that stands
# for it. The arguments after the name are the service's NAME=value
# assignments and then its command, run under `env -i` so that nothing but
# those and DEV_ENV_BASE_VARIABLES reaches it.
#
# That pid is also the id of a process group holding nothing else, because job
# control puts a background job in a group of its own, and
# dev_env_stop_process_group signals the group rather than the single pid.
# The distinction is what stops the pnpm-launched services: their recorded pid
# heads a chain (`pnpm` -> `sh -c` -> `next dev` -> `next-server`) whose last
# link is the one holding the port, and it outlives a signal to the pid alone.
dev_env_start_background() {
  local run_dir="$1" process_name="$2" pid name inherited=()
  shift 2
  for name in "${DEV_ENV_BASE_VARIABLES[@]}"; do
    [[ -z "${!name+set}" ]] || inherited+=("${name}=${!name}")
  done
  set -m
  nohup env -i "${inherited[@]}" "$@" > "${run_dir}/${process_name}.log" 2>&1 < /dev/null &
  pid="$!"
  set +m
  # The pid file is the only handle the profile keeps, so the job is dropped
  # from this shell rather than reported back over whatever it prints next.
  disown "%%"
  printf '%s\n' "${pid}" > "${run_dir}/${process_name}.pid"
}

dev_env_process_group_is_running() {
  kill -0 -- "-$1" 2> /dev/null
}

# Prints the command line of every process in a process group. `ps -A -o
# pgid=,args=` is the portable spelling; pgrep's process group selector takes
# a different option letter on the BSD side.
dev_env_process_group_commands() {
  ps -A -o pgid=,args= 2> /dev/null | awk -v pgid="$1" '$1 == pgid { $1 = ""; print }'
}

# A recorded pid stands for a profile's service only while some member of its
# group still runs from this worktree. Once the group is gone the number is
# free for any process to take, and a group that names another worktree
# belongs to that one.
dev_env_process_group_belongs_to_repo() {
  dev_env_process_group_commands "$1" | grep -qF -- "${REPO_ROOT}"
}

dev_env_wait_for_process_group() {
  local pgid="$1" tenths=$(($2 * 10))
  while ((tenths > 0)); do
    dev_env_process_group_is_running "${pgid}" || return 0
    sleep 0.1
    tenths=$((tenths - 1))
  done
  ! dev_env_process_group_is_running "${pgid}"
}

# Ends one process group and reports whether it is gone, so that its caller
# can keep the pid file of a group that outlived the attempt.
dev_env_stop_process_group() {
  local pgid="$1"
  dev_env_process_group_is_running "${pgid}" || return 0
  if ! dev_env_process_group_belongs_to_repo "${pgid}"; then
    dev_env_error "not signalling process group ${pgid}; it no longer belongs to ${REPO_ROOT}"
    return 0
  fi
  kill -s TERM -- "-${pgid}" 2> /dev/null || true
  dev_env_wait_for_process_group "${pgid}" "${DEV_ENV_STOP_TERM_SECONDS}" && return 0
  kill -s KILL -- "-${pgid}" 2> /dev/null || true
  dev_env_wait_for_process_group "${pgid}" "${DEV_ENV_STOP_KILL_SECONDS}"
}

dev_env_stop_profile() {
  local name="$1" run_dir pid_file pgid survivors=0
  run_dir="$(dev_env_profile_run_dir "${name}")"
  [[ -d "${run_dir}" ]] || return 0
  dev_env_stop_edge "${name}" || survivors=1
  for pid_file in "${run_dir}"/*.pid; do
    [[ -f "${pid_file}" ]] || continue
    pgid="$(< "${pid_file}")"
    if [[ ! "${pgid}" =~ ^[0-9]+$ ]]; then
      dev_env_error "removing ${pid_file}; it does not name a process"
      rm -f "${pid_file}"
      continue
    fi
    # A pid file is removed once nothing is left under the pid it names, so an
    # attempt that could not finish leaves the names a repeated stop needs.
    if dev_env_stop_process_group "${pgid}"; then
      rm -f "${pid_file}"
    else
      dev_env_error "${pid_file##*/} still has processes in group ${pgid}"
      survivors=1
    fi
  done
  ((survivors == 0)) || dev_env_die "profile ${name} was not fully stopped; run: task dev-env:stop"
  rmdir "${run_dir}" 2> /dev/null || true
  printf 'stopped profile %q\n' "${name}"
}
