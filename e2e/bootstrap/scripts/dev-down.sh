#!/usr/bin/env bash
# Stop the `task dev` process group started by dev-up.sh.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

pgid="$(cat "${DEV_PGID_FILE}" 2>/dev/null || true)"
if [[ -z "${pgid}" ]]; then
  exit 0
fi
rm -f "${DEV_PGID_FILE}"

if ! kill -0 "-${pgid}" 2>/dev/null; then
  exit 0
fi

bootstrap_log "stopping task dev (process group ${pgid})"
kill -TERM "-${pgid}" 2>/dev/null || true

for _ in $(seq 1 60); do
  if ! kill -0 "-${pgid}" 2>/dev/null; then
    bootstrap_log "task dev stopped"
    exit 0
  fi
  sleep 0.5
done

bootstrap_log "force-killing task dev (process group ${pgid})"
kill -KILL "-${pgid}" 2>/dev/null || true
