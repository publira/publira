#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
stop_pid_file "web-platform"
stop_pid_file "web-admin"
stop_pid_file "web-host"
stop_pid_file "publish-episodes"
stop_pid_file "platform-api-server"
stop_pid_file "admin-api-server"
stop_pid_file "api-server"
