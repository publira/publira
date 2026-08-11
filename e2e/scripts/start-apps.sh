#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

# Avoid double-starts leaving orphan processes.
bash "${E2E_SCRIPTS_DIR}/stop-apps.sh" || true

start_web_app() {
  local app_name="$1"
  local app_port="$2"
  local bind_host="$3"
  local grpc_url_env_name="$4"
  local grpc_url_value="$5"
  local cache_app="$6"

  local app_dir="${REPO_ROOT}/apps/${app_name}"
  local standalone_server="${app_dir}/.next/standalone/apps/${app_name}/server.js"
  if [[ ! -f "${standalone_server}" ]]; then
    e2e_err "${app_name} standalone build missing (${standalone_server}); run: pnpm build --filter @publira/${app_name}"
    exit 1
  fi

  # Standalone server expects static assets next to the server bundle.
  local standalone_app_dir
  standalone_app_dir="$(dirname "${standalone_server}")"
  mkdir -p "${standalone_app_dir}/.next"
  if [[ -d "${app_dir}/.next/static" ]]; then
    rm -rf "${standalone_app_dir}/.next/static"
    cp -a "${app_dir}/.next/static" "${standalone_app_dir}/.next/static"
  fi
  if [[ -d "${app_dir}/public" ]]; then
    rm -rf "${standalone_app_dir}/public"
    cp -a "${app_dir}/public" "${standalone_app_dir}/public"
  fi

  if ss -ltn 2>/dev/null | grep -qE ":${app_port}\\b" || netstat -ltn 2>/dev/null | grep -qE ":${app_port}\\b"; then
    e2e_err "port ${app_port} is already in use; free it or override E2E_*_PORT"
    exit 1
  fi

  local web_mode="${E2E_WEB_MODE:-start}"
  e2e_log "starting ${app_name} (mode=${web_mode}, host=${bind_host}, port ${app_port})"

  if [[ "${web_mode}" == "dev" ]]; then
    (
      cd "${app_dir}"
      env \
        PORT="${app_port}" \
        HOSTNAME="${bind_host}" \
        REDIS_URL="${REDIS_URL}" \
        NEXT_CACHE_APP="${cache_app}" \
        "${grpc_url_env_name}=${grpc_url_value}" \
        pnpm exec next dev --port "${app_port}" --hostname "${bind_host}"
    ) >"${LOG_DIR}/${app_name}.log" 2>&1 &
  else
    (
      cd "${standalone_app_dir}"
      env \
        PORT="${app_port}" \
        HOSTNAME="${bind_host}" \
        REDIS_URL="${REDIS_URL}" \
        NEXT_CACHE_APP="${cache_app}" \
        "${grpc_url_env_name}=${grpc_url_value}" \
        node server.js
    ) >"${LOG_DIR}/${app_name}.log" 2>&1 &
  fi
  write_pid "${app_name}" $!
}

for port in \
  "${E2E_PUBLIC_API_PORT}" \
  "${E2E_PUBLIC_API_GRPC_PORT}" \
  "${E2E_ADMIN_API_PORT}" \
  "${E2E_ADMIN_API_GRPC_PORT}" \
  "${E2E_WEB_HOST_PORT}" \
  "${E2E_WEB_ADMIN_PORT}"; do
  if ss -ltn 2>/dev/null | grep -qE ":${port}\\b" || netstat -ltn 2>/dev/null | grep -qE ":${port}\\b"; then
    e2e_err "port ${port} is already in use; free it or override E2E_*_PORT"
    exit 1
  fi
done

# Shared with the outage scenario, which restarts api-server on its own and
# appends to the same log; truncate here so a run starts from a clean file.
: >"${LOG_DIR}/api-server.log"
: >"${LOG_DIR}/admin-api-server.log"
: >"${LOG_DIR}/publish-episodes.log"

bash "${E2E_SCRIPTS_DIR}/api-server.sh" start
bash "${E2E_SCRIPTS_DIR}/admin-api-server.sh" start
bash "${E2E_SCRIPTS_DIR}/publish-episodes.sh" start

# Bind hostname must match browser Host so Next internal rewrites are not
# treated as external proxies (127.0.0.1 vs localhost → socket hang up).
start_web_app \
  "web-host" \
  "${E2E_WEB_HOST_PORT}" \
  "${E2E_WEB_BIND_HOST:-localhost}" \
  "PUBLIRA_PUBLIC_GRPC_URL" \
  "${PUBLIRA_PUBLIC_GRPC_URL}" \
  "web-host"

# web-admin is reached as admin.localhost (seed admin_domain). Chromium resolves
# *.localhost to loopback; the server must bind a hostname that accepts that Host.
start_web_app \
  "web-admin" \
  "${E2E_WEB_ADMIN_PORT}" \
  "${E2E_WEB_ADMIN_BIND_HOST:-0.0.0.0}" \
  "PUBLIRA_ADMIN_GRPC_URL" \
  "${PUBLIRA_ADMIN_GRPC_URL}" \
  "web-admin"

e2e_log "apps started (logs under ${LOG_DIR})"
