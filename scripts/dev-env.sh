#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=dev-env/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-env/lib.sh"

usage() {
  cat <<'EOF'
Usage: scripts/dev-env.sh <command> [name]

Commands:
  create <name>  Allocate a profile and select it for this worktree.
  select <name>  Select an existing profile for this worktree.
  init [name]    Create its PostgreSQL database, apply migrations/seeds, and create its bucket.
  start [name]   Start the complete isolated local stack.
  stop [name]    Stop processes started by this profile.
  destroy <name> Destroy one unselected, stopped profile after typing its name.
  list           Show profiles and their current worktree selections.
  show [name]    Print non-secret profile settings.
  env [name]     Print shell export statements for a selected profile.
EOF
}

profile_name_or_selected() {
  if [[ $# -gt 0 ]]; then
    dev_env_validate_name "$1"
    printf '%s\n' "$1"
    return 0
  fi
  local selected
  if ! selected="$(dev_env_read_selection)"; then
    dev_env_error "no profile is selected; run: task dev-env:create NAME=<name>"
    return 1
  fi
  printf '%s\n' "${selected}"
}

create_profile() {
  local name="$1"
  dev_env_validate_name "${name}"
  dev_env_ensure_home
  [[ ! -f "$(dev_env_profile_path "${name}")" ]] || dev_env_die "profile already exists: ${name}"
  dev_env_write_profile "${name}" "$(dev_env_next_slot)"
  dev_env_select "${name}"
  printf 'created and selected profile %q (run task dev-env:init)\n' "${name}"
}

init_profile() {
  local name="$1"
  dev_env_load_profile "${name}"
  local db_name="publira_${DEV_ENV_NAME//-/_}"
  local admin_url="${PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL:-postgres://postgres:password@db:5432/postgres?sslmode=disable}"
  if ! psql "${admin_url}" -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" | grep -qx '1'; then
    psql "${admin_url}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${db_name}\""
  fi
  PUBLIRA_DB_URL="${PUBLIRA_DB_URL}" task -d "${REPO_ROOT}" db:setup
  PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET}" task -d "${REPO_ROOT}" storage:init
  printf 'initialized profile %q (database=%s, redis-db=%s, bucket=%s)\n' \
    "${DEV_ENV_NAME}" "${db_name}" "${DEV_ENV_SLOT}" "${PUBLIRA_S3_BUCKET}"
}

profile_run_dir() {
  printf '%s/runs/%s\n' "${DEV_ENV_HOME}" "$1"
}

stop_profile() {
  local name="$1" run_dir pid_file pid command
  run_dir="$(profile_run_dir "${name}")"
  [[ -d "${run_dir}" ]] || return 0
  for pid_file in "${run_dir}"/*.pid; do
    [[ -f "${pid_file}" ]] || continue
    pid="$(<"${pid_file}")"
    if [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null; then
      command="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
      if [[ "${command}" == *"${REPO_ROOT}"* ]]; then
        kill "${pid}"
      else
        dev_env_error "not killing stale pid ${pid}; it no longer belongs to ${REPO_ROOT}"
      fi
    fi
    rm -f "${pid_file}"
  done
  rmdir "${run_dir}" 2>/dev/null || true
  printf 'stopped profile %q\n' "${name}"
}

start_background() {
  local run_dir="$1" process_name="$2"
  shift 2
  nohup "$@" >"${run_dir}/${process_name}.log" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"${run_dir}/${process_name}.pid"
}

start_profile() {
  local name="$1" run_dir
  dev_env_load_profile "${name}"
  run_dir="$(profile_run_dir "${name}")"
  mkdir -p "${run_dir}"
  if compgen -G "${run_dir}/*.pid" >/dev/null; then
    dev_env_die "profile ${name} already has running processes; run: task dev-env:stop"
  fi
  local port
  for port in \
    "${PUBLIRA_WEB_HOST_PORT}" "${PUBLIRA_WEB_ADMIN_PORT}" "${PUBLIRA_WEB_PLATFORM_PORT}" \
    "${PUBLIRA_PUBLIC_API_PORT}" "${PUBLIRA_PUBLIC_API_GRPC_PORT}" \
    "${PUBLIRA_ADMIN_API_PORT}" "${PUBLIRA_ADMIN_API_GRPC_PORT}" \
    "${PUBLIRA_PLATFORM_API_PORT}" "${PUBLIRA_PLATFORM_API_GRPC_PORT}" \
    "${PUBLIRA_IMAGE_SERVER_PORT}" "${PUBLIRA_ADMIN_IMAGE_SERVER_PORT}" \
    "${PUBLIRA_EMAIL_RENDERER_PORT}" "${PUBLIRA_OUTBOX_WORKER_PORT}"; do
    if ss -ltn 2>/dev/null | grep -qE ":${port}\\b" || netstat -ltn 2>/dev/null | grep -qE ":${port}\\b"; then
      dev_env_die "port ${port} is already in use; select a different profile"
    fi
  done
  init_profile "${name}"
  task -d "${REPO_ROOT}" server:build

  start_background "${run_dir}" api-server env \
    PUBLIRA_PUBLIC_API_ADDR=":${PUBLIRA_PUBLIC_API_PORT}" \
    PUBLIRA_PUBLIC_API_GRPC_ADDR=":${PUBLIRA_PUBLIC_API_GRPC_PORT}" \
    PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL}" \
    PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
    PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET}" \
    PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT}" \
    PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE}" \
    "${REPO_ROOT}/server/bin/api-server"
  start_background "${run_dir}" admin-api-server env \
    PUBLIRA_ADMIN_API_ADDR=":${PUBLIRA_ADMIN_API_PORT}" \
    PUBLIRA_ADMIN_API_GRPC_ADDR=":${PUBLIRA_ADMIN_API_GRPC_PORT}" \
    PUBLIRA_ADMIN_DB_URL="${PUBLIRA_ADMIN_DB_URL}" \
    PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
    PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET}" \
    PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT}" \
    PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE}" \
    PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
    PUBLIRA_WEB_HOST_INTERNAL_URL="${PUBLIRA_WEB_HOST_INTERNAL_URL}" \
    PUBLIRA_WEB_ADMIN_INTERNAL_URL="${PUBLIRA_WEB_ADMIN_INTERNAL_URL}" \
    PUBLIRA_WEB_PLATFORM_INTERNAL_URL="${PUBLIRA_WEB_PLATFORM_INTERNAL_URL}" \
    "${REPO_ROOT}/server/bin/admin-api-server"
  start_background "${run_dir}" platform-api-server env \
    PUBLIRA_PLATFORM_API_ADDR=":${PUBLIRA_PLATFORM_API_PORT}" \
    PUBLIRA_PLATFORM_API_GRPC_ADDR=":${PUBLIRA_PLATFORM_API_GRPC_PORT}" \
    PUBLIRA_PLATFORM_DB_URL="${PUBLIRA_PLATFORM_DB_URL}" \
    PUBLIRA_PLATFORM_APP_URL="${PUBLIRA_PLATFORM_APP_URL}" \
    PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
    "${REPO_ROOT}/server/bin/platform-api-server"
  start_background "${run_dir}" image-server env \
    PUBLIRA_IMAGE_SERVER_ADDR=":${PUBLIRA_IMAGE_SERVER_PORT}" \
    PUBLIRA_IMAGE_DB_URL="${PUBLIRA_IMAGE_DB_URL}" \
    PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" \
    PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET}" \
    PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT}" \
    PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE}" \
    PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
    "${REPO_ROOT}/server/bin/image-server"
  start_background "${run_dir}" admin-image-server env \
    PUBLIRA_ADMIN_IMAGE_SERVER_ADDR=":${PUBLIRA_ADMIN_IMAGE_SERVER_PORT}" \
    PUBLIRA_ADMIN_IMAGE_DB_URL="${PUBLIRA_ADMIN_IMAGE_DB_URL}" \
    PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" \
    PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET}" \
    PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT}" \
    PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE}" \
    PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
    "${REPO_ROOT}/server/bin/admin-image-server"
  start_background "${run_dir}" outbox-worker env \
    PUBLIRA_DB_URL="${PUBLIRA_WORKER_DB_URL}" \
    PUBLIRA_WORKER_DB_URL="${PUBLIRA_WORKER_DB_URL}" \
    PUBLIRA_WORKER_ADDR=":${PUBLIRA_OUTBOX_WORKER_PORT}" \
    PUBLIRA_EMAIL_RENDERER_URL="${PUBLIRA_EMAIL_RENDERER_URL}" \
    "${REPO_ROOT}/server/bin/outbox-worker"
  start_background "${run_dir}" publish-episodes env \
    PUBLIRA_DB_URL="${PUBLIRA_WORKER_DB_URL}" \
    PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
    PUBLIRA_WEB_HOST_INTERNAL_URL="${PUBLIRA_WEB_HOST_INTERNAL_URL}" \
    PUBLIRA_WEB_ADMIN_INTERNAL_URL="${PUBLIRA_WEB_ADMIN_INTERNAL_URL}" \
    PUBLIRA_WEB_PLATFORM_INTERNAL_URL="${PUBLIRA_WEB_PLATFORM_INTERNAL_URL}" \
    "${REPO_ROOT}/server/bin/publish-episodes"
  start_background "${run_dir}" email-renderer env PORT="${PUBLIRA_EMAIL_RENDERER_PORT}" \
    pnpm --dir "${REPO_ROOT}/apps/email-renderer" dev
  start_background "${run_dir}" web-host env PORT="${PUBLIRA_WEB_HOST_PORT}" \
    PUBLIRA_AUTH_SECRET="${PUBLIRA_AUTH_SECRET}" PUBLIRA_COOKIE_SUFFIX="${PUBLIRA_COOKIE_SUFFIX}" \
    PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" PUBLIRA_PUBLIC_GRPC_URL="${PUBLIRA_PUBLIC_GRPC_URL}" \
    PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
    pnpm --dir "${REPO_ROOT}/apps/web-host" dev
  start_background "${run_dir}" web-admin env PORT="${PUBLIRA_WEB_ADMIN_PORT}" \
    PUBLIRA_AUTH_SECRET="${PUBLIRA_AUTH_SECRET}" PUBLIRA_COOKIE_SUFFIX="${PUBLIRA_COOKIE_SUFFIX}" \
    PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" PUBLIRA_ADMIN_GRPC_URL="${PUBLIRA_ADMIN_GRPC_URL}" \
    PUBLIRA_PUBLIC_GRPC_URL="${PUBLIRA_PUBLIC_GRPC_URL}" \
    PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
    pnpm --dir "${REPO_ROOT}/apps/web-admin" dev
  start_background "${run_dir}" web-platform env PORT="${PUBLIRA_WEB_PLATFORM_PORT}" \
    PUBLIRA_AUTH_SECRET="${PUBLIRA_AUTH_SECRET}" PUBLIRA_COOKIE_SUFFIX="${PUBLIRA_COOKIE_SUFFIX}" \
    PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" PUBLIRA_PLATFORM_GRPC_URL="${PUBLIRA_PLATFORM_GRPC_URL}" \
    PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
    pnpm --dir "${REPO_ROOT}/apps/web-platform" dev
  printf 'started profile %q\n  host:     http://localhost:%s\n  admin:    http://admin.localhost:%s\n  platform: %s\n  logs:     %s\n' \
    "${name}" "${PUBLIRA_WEB_HOST_PORT}" "${PUBLIRA_WEB_ADMIN_PORT}" "${PUBLIRA_PLATFORM_APP_URL}" "${run_dir}"
}

destroy_profile() {
  local name="$1" profile_path db_name in_use
  local s3_endpoint_args=()
  dev_env_load_profile "${name}"
  in_use="$(dev_env_profile_in_use "${name}")"
  [[ -z "${in_use}" ]] || dev_env_die "profile ${name} is still selected by: ${in_use}"
  [[ ! -d "$(profile_run_dir "${name}")" ]] || dev_env_die "stop profile ${name} before destroying it"
  read -r -p "Type ${name} to destroy its database, Valkey DB, and bucket: " confirmation
  [[ "${confirmation}" == "${name}" ]] || dev_env_die "confirmation did not match; nothing was destroyed"
  db_name="publira_${DEV_ENV_NAME//-/_}"
  psql "${PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL:-postgres://postgres:password@db:5432/postgres?sslmode=disable}" \
    -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${db_name}\" WITH (FORCE)"
  redis-cli -u "${PUBLIRA_REDIS_URL}" FLUSHDB
  if [[ -n "${PUBLIRA_S3_ENDPOINT}" ]]; then
    s3_endpoint_args=(--endpoint-url "${PUBLIRA_S3_ENDPOINT}")
  fi
  aws "${s3_endpoint_args[@]}" s3 rb "s3://${PUBLIRA_S3_BUCKET}" --force
  profile_path="$(dev_env_profile_path "${name}")"
  rm -f "${profile_path}"
  printf 'destroyed profile %q\n' "${name}"
}

show_profile() {
  local name="$1" db_path db_name
  dev_env_load_profile "${name}"
  db_path="${PUBLIRA_DB_URL##*/}"
  db_name="${db_path%%\?*}"
  printf 'name: %s\nworktree: %s\nslot: %s\ndatabase: %s\nredis: %s\nbucket: %s\nweb-host: http://localhost:%s\nweb-admin: http://admin.localhost:%s\nweb-platform: %s\n' \
    "${DEV_ENV_NAME}" "${DEV_ENV_OWNER_WORKTREE}" "${DEV_ENV_SLOT}" "${db_name}" "${PUBLIRA_REDIS_URL}" \
    "${PUBLIRA_S3_BUCKET}" "${PUBLIRA_WEB_HOST_PORT}" "${PUBLIRA_WEB_ADMIN_PORT}" "${PUBLIRA_PLATFORM_APP_URL}"
}

print_env() {
  local name="$1" key
  dev_env_load_profile "${name}"
  for key in $(awk -F= '/^[A-Z0-9_]+=/{print $1}' "$(dev_env_profile_path "${name}")"); do
    printf 'export %s=%q\n' "${key}" "${!key}"
  done
}

list_profiles() {
  local profile name selected worktrees
  dev_env_ensure_home
  shopt -s nullglob
  for profile in "${DEV_ENV_PROFILES_DIR}"/*.env; do
    name="$(dev_env_profile_value "${profile}" DEV_ENV_NAME)"
    selected=""
    worktrees="$(dev_env_profile_in_use "${name}" | paste -sd ', ' -)"
    [[ -n "${worktrees}" ]] && selected=" selected by ${worktrees}"
    printf '%s (slot %s)%s\n' "${name}" "$(dev_env_profile_value "${profile}" DEV_ENV_SLOT)" "${selected}"
  done
  shopt -u nullglob
}

command="${1:-}"
shift || true
case "${command}" in
  create)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    create_profile "$1"
    ;;
  select)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    dev_env_select "$1"
    ;;
  init)
    profile_name="$(profile_name_or_selected "$@")" || exit 1
    init_profile "${profile_name}"
    ;;
  start)
    profile_name="$(profile_name_or_selected "$@")" || exit 1
    start_profile "${profile_name}"
    ;;
  stop)
    profile_name="$(profile_name_or_selected "$@")" || exit 1
    stop_profile "${profile_name}"
    ;;
  destroy)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    destroy_profile "$1"
    ;;
  list) list_profiles ;;
  show)
    profile_name="$(profile_name_or_selected "$@")" || exit 1
    show_profile "${profile_name}"
    ;;
  env)
    profile_name="$(profile_name_or_selected "$@")" || exit 1
    print_env "${profile_name}"
    ;;
  *) usage; exit 2 ;;
esac
