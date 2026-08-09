#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

# Avoid double-starts leaving orphan processes.
bash "${E2E_SCRIPTS_DIR}/stop-apps.sh" || true

web_host_dir="${REPO_ROOT}/apps/web-host"
standalone_server="${web_host_dir}/.next/standalone/apps/web-host/server.js"
if [[ ! -f "${standalone_server}" ]]; then
  e2e_err "web-host standalone build missing (${standalone_server}); run: pnpm build --filter @publira/web-host"
  exit 1
fi

# Standalone server expects static assets next to the server bundle.
standalone_app_dir="$(dirname "${standalone_server}")"
mkdir -p "${standalone_app_dir}/.next"
if [[ -d "${web_host_dir}/.next/static" ]]; then
  rm -rf "${standalone_app_dir}/.next/static"
  cp -a "${web_host_dir}/.next/static" "${standalone_app_dir}/.next/static"
fi
if [[ -d "${web_host_dir}/public" ]]; then
  rm -rf "${standalone_app_dir}/public"
  cp -a "${web_host_dir}/public" "${standalone_app_dir}/public"
fi

for port in "${E2E_PUBLIC_API_PORT}" "${E2E_PUBLIC_API_GRPC_PORT}" "${E2E_WEB_HOST_PORT}"; do
  if ss -ltn 2>/dev/null | grep -qE ":${port}\\b" || netstat -ltn 2>/dev/null | grep -qE ":${port}\\b"; then
    e2e_err "port ${port} is already in use; free it or override E2E_*_PORT"
    exit 1
  fi
done

# Shared with the outage scenario, which restarts api-server on its own and
# appends to the same log; truncate here so a run starts from a clean file.
: >"${LOG_DIR}/api-server.log"
bash "${E2E_SCRIPTS_DIR}/api-server.sh" start

web_mode="${E2E_WEB_MODE:-start}"
e2e_log "starting web-host (mode=${web_mode}, port ${E2E_WEB_HOST_PORT})"
# Bind hostname must match browser Host (localhost) so Next internal rewrites
# are not treated as external proxies (127.0.0.1 vs localhost → socket hang up).
web_bind_host="${E2E_WEB_BIND_HOST:-localhost}"

if [[ "${web_mode}" == "dev" ]]; then
  (
    cd "${web_host_dir}"
    env \
      PORT="${E2E_WEB_HOST_PORT}" \
      HOSTNAME="${web_bind_host}" \
      REDIS_URL="${REDIS_URL}" \
      NEXT_CACHE_APP="${NEXT_CACHE_APP}" \
      PUBLIRA_PUBLIC_GRPC_URL="${PUBLIRA_PUBLIC_GRPC_URL}" \
      pnpm exec next dev --port "${E2E_WEB_HOST_PORT}" --hostname "${web_bind_host}"
  ) >"${LOG_DIR}/web-host.log" 2>&1 &
else
  # output: "standalone" — use the generated server, not `next start`.
  (
    cd "${standalone_app_dir}"
    env \
      PORT="${E2E_WEB_HOST_PORT}" \
      HOSTNAME="${web_bind_host}" \
      REDIS_URL="${REDIS_URL}" \
      NEXT_CACHE_APP="${NEXT_CACHE_APP}" \
      PUBLIRA_PUBLIC_GRPC_URL="${PUBLIRA_PUBLIC_GRPC_URL}" \
      node server.js
  ) >"${LOG_DIR}/web-host.log" 2>&1 &
fi
write_pid "web-host" $!

e2e_log "apps started (logs under ${LOG_DIR})"
