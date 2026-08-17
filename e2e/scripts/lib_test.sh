#!/usr/bin/env bash
# Fast checks for E2E_RUN_DIR isolation and the compose-project lock.
# No Docker, no compiled binaries. Invoked from run.sh so a regression cannot
# ship as "two stacks share api-server.pid" again (#685).
set -euo pipefail

E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${E2E_SCRIPTS_DIR}/lib.sh"
E2E_DIR="$(cd "${E2E_SCRIPTS_DIR}/.." && pwd)"

failures=0
fail() {
  printf '[e2e] lib_test FAIL: %s\n' "$*" >&2
  failures=$((failures + 1))
}

pass() {
  printf '[e2e] lib_test ok: %s\n' "$*"
}

# Drop inherited stack knobs so each child sees a clean default, then apply
# only the overrides passed as NAME=value arguments.
stack_env() {
  env \
    -u E2E_RUN_DIR \
    -u COMPOSE_PROJECT_NAME \
    -u E2E_POSTGRES_PORT \
    -u E2E_REDIS_PORT \
    -u E2E_RUSTFS_PORT \
    -u PUBLIRA_S3_ENDPOINT \
    -u E2E_WEB_HOST_PORT \
    -u E2E_WEB_ADMIN_PORT \
    -u E2E_WEB_PLATFORM_PORT \
    -u E2E_PUBLIC_API_PORT \
    -u E2E_PUBLIC_API_GRPC_PORT \
    -u E2E_ADMIN_API_PORT \
    -u E2E_ADMIN_API_GRPC_PORT \
    -u E2E_PLATFORM_API_PORT \
    -u E2E_PLATFORM_API_GRPC_PORT \
    -u E2E_LOCK_HELD \
    "$@"
}

compute_run_dir() {
  stack_env "$@" bash -c 'source "$1"; printf %s "$E2E_RUN_DIR"' bash "${LIB}"
}

default_run_dir="$(compute_run_dir)"
if [[ "${default_run_dir}" == "${E2E_DIR}/.run" ]]; then
  pass "default stack keeps e2e/.run"
else
  fail "default E2E_RUN_DIR is ${default_run_dir}, want ${E2E_DIR}/.run"
fi

host_override_dir="$(compute_run_dir E2E_WEB_HOST_PORT=3001)"
if [[ "${host_override_dir}" == "${default_run_dir}" ]]; then
  fail "E2E_WEB_HOST_PORT override still uses ${host_override_dir}"
elif [[ "${host_override_dir}" != *"-h3001-"* ]]; then
  fail "E2E_WEB_HOST_PORT override dir ${host_override_dir} does not encode h3001"
else
  pass "E2E_WEB_HOST_PORT override isolates RUN_DIR"
fi

api_override_dir="$(compute_run_dir E2E_PUBLIC_API_PORT=8010)"
if [[ "${api_override_dir}" == "${default_run_dir}" ]]; then
  fail "E2E_PUBLIC_API_PORT override still uses ${api_override_dir}"
else
  pass "E2E_PUBLIC_API_PORT override isolates RUN_DIR"
fi

project_override_dir="$(compute_run_dir COMPOSE_PROJECT_NAME=publira-e2e-alt)"
if [[ "${project_override_dir}" == "${default_run_dir}" ]]; then
  fail "COMPOSE_PROJECT_NAME override still uses ${project_override_dir}"
elif [[ "${project_override_dir}" != *"/publira-e2e-alt-"* ]]; then
  fail "COMPOSE_PROJECT_NAME override dir ${project_override_dir} does not encode project"
else
  pass "COMPOSE_PROJECT_NAME override isolates RUN_DIR"
fi

explicit_dir="$(compute_run_dir E2E_RUN_DIR=/tmp/publira-e2e-explicit E2E_WEB_HOST_PORT=3001)"
if [[ "${explicit_dir}" == "/tmp/publira-e2e-explicit" ]]; then
  pass "explicit E2E_RUN_DIR wins over port overrides"
else
  fail "explicit E2E_RUN_DIR became ${explicit_dir}"
fi

if [[ "${host_override_dir}" == "${api_override_dir}" ]]; then
  fail "distinct port overrides collapsed to ${host_override_dir}"
else
  pass "distinct port overrides get distinct RUN_DIRs"
fi

compute_redis_url() {
  stack_env "$@" bash -c 'source "$1"; printf %s "$PUBLIRA_REDIS_URL"' bash "${LIB}"
}

default_redis="$(compute_redis_url PUBLIRA_REDIS_URL=redis://redis:6379)"
if [[ "${default_redis}" == "redis://127.0.0.1:6380" ]]; then
  pass "ambient PUBLIRA_REDIS_URL does not override E2E Redis"
else
  fail "ambient PUBLIRA_REDIS_URL leaked through as ${default_redis}"
fi

port_redis="$(compute_redis_url E2E_REDIS_PORT=6381 PUBLIRA_REDIS_URL=redis://redis:6379)"
if [[ "${port_redis}" == "redis://127.0.0.1:6381" ]]; then
  pass "E2E_REDIS_PORT drives PUBLIRA_REDIS_URL"
else
  fail "E2E_REDIS_PORT=6381 produced PUBLIRA_REDIS_URL=${port_redis}"
fi

compute_s3_endpoint() {
  stack_env "$@" bash -c 'source "$1"; printf %s "$PUBLIRA_S3_ENDPOINT"' bash "${LIB}"
}

default_s3_endpoint="$(compute_s3_endpoint PUBLIRA_S3_ENDPOINT=http://rustfs:9000)"
if [[ "${default_s3_endpoint}" == "http://127.0.0.1:9003" ]]; then
  pass "ambient PUBLIRA_S3_ENDPOINT does not override E2E RustFS"
else
  fail "ambient PUBLIRA_S3_ENDPOINT leaked through as ${default_s3_endpoint}"
fi

port_s3_endpoint="$(compute_s3_endpoint E2E_RUSTFS_PORT=9004 PUBLIRA_S3_ENDPOINT=http://rustfs:9000)"
if [[ "${port_s3_endpoint}" == "http://127.0.0.1:9004" ]]; then
  pass "E2E_RUSTFS_PORT drives PUBLIRA_S3_ENDPOINT"
else
  fail "E2E_RUSTFS_PORT=9004 produced PUBLIRA_S3_ENDPOINT=${port_s3_endpoint}"
fi

# Two stacks, two sleep stand-ins. Dedicated temp RUN_DIRs so this never
# overwrites a live stack's api-server.pid (run.sh invokes us before locking).
pid_root="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-pids.XXXXXX")"
dir_a="${pid_root}/a"
dir_b="${pid_root}/b"
sleep 120 &
pid_a=$!
sleep 120 &
pid_b=$!
cleanup_sleeps() {
  kill "${pid_a}" "${pid_b}" 2>/dev/null || true
  wait "${pid_a}" "${pid_b}" 2>/dev/null || true
  rm -rf "${pid_root}"
}
trap cleanup_sleeps EXIT

stack_env E2E_RUN_DIR="${dir_a}" bash -c '
  source "$1"
  ensure_run_dirs
  write_pid api-server "$2"
' bash "${LIB}" "${pid_a}"
stack_env E2E_RUN_DIR="${dir_b}" bash -c '
  source "$1"
  ensure_run_dirs
  write_pid api-server "$2"
' bash "${LIB}" "${pid_b}"

stack_env E2E_RUN_DIR="${dir_a}" bash -c '
  source "$1"
  stop_pid_file api-server
' bash "${LIB}"

if kill -0 "${pid_a}" 2>/dev/null; then
  fail "stack A api-server stand-in (pid ${pid_a}) still running after stop"
else
  pass "stop_pid_file kills only the matching RUN_DIR process"
fi
if kill -0 "${pid_b}" 2>/dev/null; then
  pass "stop_pid_file leaves the other RUN_DIR process running"
else
  fail "stack B api-server stand-in (pid ${pid_b}) was stopped by stack A"
fi

kill "${pid_b}" 2>/dev/null || true
wait "${pid_a}" "${pid_b}" 2>/dev/null || true
rm -rf "${pid_root}"
trap - EXIT

# Lease outlives the acquiring shell (up.sh exits, stack stays). A foreign
# E2E_RUN_DIR must not acquire or release; the owner leftover down may.
lock_project="publira-e2e-libtest-$$"
lease_root="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-lease.XXXXXX")"
lease_a="${lease_root}/a"
lease_b="${lease_root}/b"
lock_err="$(mktemp)"
cleanup_lease() {
  stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
    source "$1"
    release_e2e_lease || true
  ' bash "${LIB}" >/dev/null 2>&1 || true
  stack_env E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}-other" bash -c '
    source "$1"
    release_e2e_lease || true
  ' bash "${LIB}" >/dev/null 2>&1 || true
  rm -rf "${lease_root}"
  rm -f "${lock_err}"
  rm -f "${E2E_DIR}/.run/locks/${lock_project}.lock" "${E2E_DIR}/.run/locks/${lock_project}.lease"
  rm -f "${E2E_DIR}/.run/locks/${lock_project}-other.lock" "${E2E_DIR}/.run/locks/${lock_project}-other.lease"
}
trap cleanup_lease EXIT

if ! stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}"; then
  fail "owner acquire did not start a lease holder"
else
  pass "acquire starts a lease holder that outlives the shell"
fi

if stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}"; then
  pass "same E2E_RUN_DIR joins the leftover lease"
else
  fail "owner leftover acquire (up then start-apps) was refused"
fi

if stack_env E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}" >"${lock_err}" 2>&1; then
  fail "foreign E2E_RUN_DIR acquire succeeded after owner up"
else
  if grep -q "already in use" "${lock_err}"; then
    pass "foreign E2E_RUN_DIR acquire is refused while the stack lease lives"
  else
    fail "foreign acquire failed without 'already in use': $(cat "${lock_err}")"
  fi
fi

if stack_env E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  require_e2e_owner_or_free
  release_e2e_lease
' bash "${LIB}" >"${lock_err}" 2>&1; then
  fail "foreign down/release succeeded after owner up"
else
  if grep -q "already in use" "${lock_err}"; then
    pass "foreign down is refused after up.sh exits"
  else
    fail "foreign down failed without 'already in use': $(cat "${lock_err}")"
  fi
fi

if stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  require_e2e_owner_or_free
  release_e2e_lease
' bash "${LIB}"; then
  pass "owner leftover down releases the lease"
else
  fail "owner leftover down was refused"
fi

if stack_env E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}-other" bash -c '
  source "$1"
  acquire_e2e_lock
  release_e2e_lease
' bash "${LIB}"; then
  pass "distinct COMPOSE_PROJECT_NAME takes its own lease"
else
  fail "distinct COMPOSE_PROJECT_NAME could not acquire lease"
fi

if stack_env E2E_LOCK_HELD=1 E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}"; then
  pass "E2E_LOCK_HELD=1 skips re-acquire"
else
  fail "E2E_LOCK_HELD=1 still tried to take the lease"
fi

trap - EXIT
cleanup_lease

if ((failures > 0)); then
  printf '[e2e] ERROR: lib_test failed (%s)\n' "${failures}" >&2
  exit 1
fi

printf '[e2e] lib_test passed\n'
