#!/usr/bin/env bash
# Shared, deliberately small state layer for isolated local development profiles.
# shellcheck shell=bash

set -euo pipefail

DEV_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${DEV_ENV_DIR}/../.." && pwd)"
DEV_ENV_HOME="${PUBLIRA_DEV_ENV_HOME:-${HOME}/.publira/dev-env}"
DEV_ENV_PROFILES_DIR="${DEV_ENV_HOME}/profiles"
DEV_ENV_SELECTION_FILE="${REPO_ROOT}/.publira-dev-env"
DEV_ENV_SLOT_MIN=1
DEV_ENV_SLOT_MAX=15

dev_env_error() {
  printf 'dev-env: %s\n' "$*" >&2
}

dev_env_die() {
  dev_env_error "$*"
  exit 1
}

dev_env_identifier_is_valid() {
  [[ "$1" =~ ^[a-z][a-z0-9-]{0,31}$ ]]
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
  selected="$(<"${DEV_ENV_SELECTION_FILE}")"
  dev_env_identifier_is_valid "${selected}" || return 1
  printf '%s\n' "${selected}"
}

dev_env_select() {
  local name="$1"
  dev_env_validate_name "${name}"
  [[ -f "$(dev_env_profile_path "${name}")" ]] || dev_env_die "profile does not exist: ${name}"
  printf '%s\n' "${name}" >"${DEV_ENV_SELECTION_FILE}"
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
  done <"${profile_path}"
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
  export "${key}"
}

dev_env_profile_in_use() {
  local name="$1"
  local worktree selection
  while IFS= read -r worktree; do
    selection="${worktree}/.publira-dev-env"
    [[ -f "${selection}" ]] || continue
    if [[ "$(<"${selection}")" == "${name}" ]]; then
      printf '%s\n' "${worktree}"
    fi
  done < <(git -C "${REPO_ROOT}" worktree list --porcelain | awk '/^worktree / {print $2}')
}

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
  dev_env_die "no Valkey logical database is available (slots ${DEV_ENV_SLOT_MIN}-${DEV_ENV_SLOT_MAX})"
}

dev_env_random_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

# Secret decryption for the SMTP password a profile's outbox worker reads. A
# worker started without keys reports an unusable secret manager, and every mail
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
    dev_env_url_authority "${PUBLIRA_DB_URL}" 5432 \
      || dev_env_die "cannot derive the PostgreSQL host from PUBLIRA_DB_URL: ${PUBLIRA_DB_URL}"
    return 0
  fi
  printf 'db:5432\n'
}

dev_env_redis_authority() {
  if [[ -n "${PUBLIRA_REDIS_URL:-}" ]]; then
    dev_env_url_authority "${PUBLIRA_REDIS_URL}" 6379 \
      || dev_env_die "cannot derive the Valkey host from PUBLIRA_REDIS_URL: ${PUBLIRA_REDIS_URL}"
    return 0
  fi
  printf 'redis:6379\n'
}

dev_env_s3_endpoint() {
  printf '%s\n' "${PUBLIRA_S3_ENDPOINT:-http://rustfs:9000}"
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
  authority="$(dev_env_url_authority "${PUBLIRA_DB_URL}" 5432)" \
    || dev_env_die "cannot derive the PostgreSQL host from PUBLIRA_DB_URL: ${PUBLIRA_DB_URL}"
  printf 'postgres://postgres:password@%s/postgres?sslmode=disable\n' "${authority}"
}

dev_env_write_profile() {
  local name="$1"
  local slot="$2"
  local profile_path tmp_path port_base postgres redis
  profile_path="$(dev_env_profile_path "${name}")"
  tmp_path="${profile_path}.tmp.$$"
  port_base=$((13000 + slot * 100))
  postgres="$(dev_env_postgres_authority)"
  redis="$(dev_env_redis_authority)"

  umask 077
  {
    printf 'DEV_ENV_NAME=%s\n' "${name}"
    printf 'DEV_ENV_SLOT=%s\n' "${slot}"
    printf 'DEV_ENV_OWNER_WORKTREE=%s\n' "${REPO_ROOT}"
    printf 'PUBLIRA_DB_URL=postgres://postgres:password@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_PUBLIC_DB_URL=postgres://publira_public:publicpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_ADMIN_DB_URL=postgres://publira_admin:adminpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_PLATFORM_DB_URL=postgres://publira_platform:platformpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_WORKER_DB_URL=postgres://publira_outbox:outboxpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_CONTENT_STATS_DB_URL=postgres://publira_content_stats:contentstatspass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_IMAGE_DB_URL=postgres://publira_public:publicpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
    printf 'PUBLIRA_ADMIN_IMAGE_DB_URL=postgres://publira_admin:adminpass@%s/publira_%s?sslmode=disable\n' "${postgres}" "${name//-/_}"
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
    printf 'PUBLIRA_ADMIN_API_PORT=%s\n' "$((port_base + 12))"
    printf 'PUBLIRA_ADMIN_API_GRPC_PORT=%s\n' "$((port_base + 13))"
    printf 'PUBLIRA_PLATFORM_API_PORT=%s\n' "$((port_base + 14))"
    printf 'PUBLIRA_PLATFORM_API_GRPC_PORT=%s\n' "$((port_base + 15))"
    printf 'PUBLIRA_IMAGE_SERVER_PORT=%s\n' "$((port_base + 20))"
    printf 'PUBLIRA_ADMIN_IMAGE_SERVER_PORT=%s\n' "$((port_base + 21))"
    printf 'PUBLIRA_EMAIL_RENDERER_PORT=%s\n' "$((port_base + 30))"
    printf 'PUBLIRA_OUTBOX_WORKER_PORT=%s\n' "$((port_base + 40))"
    printf 'PUBLIRA_PUBLIC_GRPC_URL=http://127.0.0.1:%s\n' "$((port_base + 11))"
    printf 'PUBLIRA_ADMIN_GRPC_URL=http://127.0.0.1:%s\n' "$((port_base + 13))"
    printf 'PUBLIRA_PLATFORM_GRPC_URL=http://127.0.0.1:%s\n' "$((port_base + 15))"
    printf 'PUBLIRA_WEB_HOST_INTERNAL_URL=http://127.0.0.1:%s\n' "${port_base}"
    printf 'PUBLIRA_WEB_ADMIN_INTERNAL_URL=http://127.0.0.1:%s\n' "$((port_base + 1))"
    printf 'PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://127.0.0.1:%s\n' "$((port_base + 2))"
    printf 'PUBLIRA_PLATFORM_APP_URL=http://platform.localhost:%s\n' "$((port_base + 2))"
    printf 'PUBLIRA_EMAIL_RENDERER_URL=http://127.0.0.1:%s\n' "$((port_base + 30))"
  } >"${tmp_path}"
  chmod 600 "${tmp_path}"
  mv "${tmp_path}" "${profile_path}"
}

dev_env_load_profile() {
  local name="$1"
  local profile_path
  profile_path="$(dev_env_profile_path "${name}")"
  [[ -f "${profile_path}" ]] || dev_env_die "profile does not exist: ${name}"

  dev_env_load_required_profile_value "${profile_path}" DEV_ENV_NAME
  dev_env_load_required_profile_value "${profile_path}" DEV_ENV_SLOT
  dev_env_load_required_profile_value "${profile_path}" DEV_ENV_OWNER_WORKTREE
  [[ "${DEV_ENV_NAME}" == "${name}" ]] || dev_env_die "profile name mismatch: ${profile_path}"
  dev_env_identifier_is_valid "${DEV_ENV_NAME}" || dev_env_die "invalid profile name in ${profile_path}"
  [[ "${DEV_ENV_SLOT}" =~ ^([1-9]|1[0-5])$ ]] || dev_env_die "invalid Valkey slot in ${profile_path}"

  local key
  for key in \
    PUBLIRA_DB_URL PUBLIRA_PUBLIC_DB_URL PUBLIRA_ADMIN_DB_URL PUBLIRA_PLATFORM_DB_URL \
    PUBLIRA_WORKER_DB_URL PUBLIRA_IMAGE_DB_URL PUBLIRA_ADMIN_IMAGE_DB_URL \
    PUBLIRA_REDIS_URL PUBLIRA_S3_BUCKET PUBLIRA_S3_ENDPOINT PUBLIRA_S3_FORCE_PATH_STYLE \
    PUBLIRA_COOKIE_SUFFIX PUBLIRA_AUTH_SECRET \
    PUBLIRA_AUTH_JWT_SECRET PUBLIRA_REVALIDATE_TOKEN PUBLIRA_WEB_HOST_PORT \
    PUBLIRA_WEB_ADMIN_PORT PUBLIRA_WEB_PLATFORM_PORT PUBLIRA_PUBLIC_API_PORT \
    PUBLIRA_PUBLIC_API_GRPC_PORT PUBLIRA_ADMIN_API_PORT PUBLIRA_ADMIN_API_GRPC_PORT \
    PUBLIRA_PLATFORM_API_PORT PUBLIRA_PLATFORM_API_GRPC_PORT PUBLIRA_IMAGE_SERVER_PORT \
    PUBLIRA_ADMIN_IMAGE_SERVER_PORT PUBLIRA_EMAIL_RENDERER_PORT PUBLIRA_OUTBOX_WORKER_PORT \
    PUBLIRA_PUBLIC_GRPC_URL PUBLIRA_ADMIN_GRPC_URL PUBLIRA_PLATFORM_GRPC_URL \
    PUBLIRA_WEB_HOST_INTERNAL_URL PUBLIRA_WEB_ADMIN_INTERNAL_URL PUBLIRA_WEB_PLATFORM_INTERNAL_URL \
    PUBLIRA_PLATFORM_APP_URL PUBLIRA_EMAIL_RENDERER_URL; do
    dev_env_load_required_profile_value "${profile_path}" "${key}"
  done

  # Profiles created before the stats batch have no key of their own. They fall
  # back to the superuser connection, which is what their worker URL was when
  # they were written; reading PUBLIRA_WORKER_DB_URL here instead would move the
  # stats batches onto publira_outbox the moment that value was repointed.
  local content_stats_url
  if ! content_stats_url="$(dev_env_profile_value "${profile_path}" PUBLIRA_CONTENT_STATS_DB_URL)"; then
    PUBLIRA_CONTENT_STATS_DB_URL="${PUBLIRA_DB_URL}"
  elif [[ -z "${content_stats_url}" ]]; then
    dev_env_die "profile has an empty PUBLIRA_CONTENT_STATS_DB_URL: ${profile_path}"
  else
    PUBLIRA_CONTENT_STATS_DB_URL="${content_stats_url}"
  fi
  export PUBLIRA_CONTENT_STATS_DB_URL
}

dev_env_selected_profile() {
  local selected
  selected="$(dev_env_read_selection)" || dev_env_die "no profile is selected; run: task dev-env:create NAME=<name>"
  printf '%s\n' "${selected}"
}
