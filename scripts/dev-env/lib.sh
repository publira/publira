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

dev_env_write_profile() {
  local name="$1"
  local slot="$2"
  local profile_path tmp_path port_base
  profile_path="$(dev_env_profile_path "${name}")"
  tmp_path="${profile_path}.tmp.$$"
  port_base=$((13000 + slot * 100))

  umask 077
  {
    printf 'DEV_ENV_NAME=%s\n' "${name}"
    printf 'DEV_ENV_SLOT=%s\n' "${slot}"
    printf 'DEV_ENV_OWNER_WORKTREE=%s\n' "${REPO_ROOT}"
    printf 'PUBLIRA_DB_URL=postgres://postgres:password@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_PUBLIC_DB_URL=postgres://publira_public:publicpass@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_ADMIN_DB_URL=postgres://publira_admin:adminpass@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_PLATFORM_DB_URL=postgres://publira_platform:platformpass@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_WORKER_DB_URL=postgres://postgres:password@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_IMAGE_DB_URL=postgres://publira_public:publicpass@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_ADMIN_IMAGE_DB_URL=postgres://publira_admin:adminpass@db:5432/publira_%s?sslmode=disable\n' "${name//-/_}"
    printf 'PUBLIRA_REDIS_URL=redis://redis:6379/%s\n' "${slot}"
    printf 'PUBLIRA_S3_BUCKET=publira-%s\n' "${name}"
    printf 'PUBLIRA_S3_ENDPOINT=%s\n' "${PUBLIRA_S3_ENDPOINT:-http://rustfs:9000}"
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
    printf 'PUBLIRA_REVALIDATE_BASE_URL=http://127.0.0.1:%s\n' "${port_base}"
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
    PUBLIRA_REVALIDATE_BASE_URL PUBLIRA_PLATFORM_APP_URL PUBLIRA_EMAIL_RENDERER_URL; do
    dev_env_load_required_profile_value "${profile_path}" "${key}"
  done
}

dev_env_selected_profile() {
  local selected
  selected="$(dev_env_read_selection)" || dev_env_die "no profile is selected; run: task dev-env:create NAME=<name>"
  printf '%s\n' "${selected}"
}
