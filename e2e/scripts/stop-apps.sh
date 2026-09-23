#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
join_e2e_lease
# Every app is tried even when one survives, so a single stubborn process does
# not leave the rest running.
status=0
for app in web-platform web-admin web-host worker email-renderer server; do
  stop_pid_file "${app}" || status=1
done
exit "${status}"
