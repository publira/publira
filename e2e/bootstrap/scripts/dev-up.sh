#!/usr/bin/env bash
# Phase 4a: start `task dev` (all Go APIs, image servers, and Next.js apps)
# in its own process group so the whole tree can be torn down later.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

bootstrap_log "=== phase 4: task dev ==="

busy=()
for port in "${BOOTSTRAP_DEV_PORTS[@]}"; do
  if port_in_use "${port}"; then
    busy+=("${port}")
  fi
done
if ((${#busy[@]} > 0)); then
  bootstrap_fail "ports already in use: ${busy[*]} — stop the running dev stack first (the app ports are fixed in apps/*/package.json)"
fi

: >"${DEV_LOG}"
rm -f "${DEV_PGID_FILE}"

# `task dev` fans out to `go run` and Turbopack children; a new session makes
# the whole tree killable by process group. The leader records its own pid,
# because setsid may fork and then `$!` would be the parent that exits.
(
  cd "${REPO_ROOT}"
  setsid bash -c 'echo $$ >"$1"; exec task dev' _ "${DEV_PGID_FILE}" \
    >"${DEV_LOG}" 2>&1 &
)

for _ in $(seq 1 50); do
  [[ -s "${DEV_PGID_FILE}" ]] && break
  sleep 0.1
done
if [[ ! -s "${DEV_PGID_FILE}" ]]; then
  bootstrap_fail "task dev did not start (no process group recorded); see ${DEV_LOG}"
fi

bootstrap_log "task dev running (process group $(cat "${DEV_PGID_FILE}"), log ${DEV_LOG})"
