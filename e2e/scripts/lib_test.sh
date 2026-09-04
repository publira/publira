#!/usr/bin/env bash
# Fast checks for E2E_RUN_DIR isolation and the compose-project lock.
# No Docker, no compiled binaries. Invoked from run.sh so a regression cannot
# ship as "two stacks share api-server.pid" again.
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
    -u E2E_MAILPIT_SMTP_PORT \
    -u E2E_MAILPIT_HTTP_PORT \
    -u E2E_MAILPIT_BASE_URL \
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
    -u E2E_OUTBOX_WORKER_PORT \
    -u E2E_IMAGE_SERVER_PORT \
    -u E2E_EDGE_PORT \
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

worker_override_dir="$(compute_run_dir E2E_OUTBOX_WORKER_PORT=8013)"
if [[ "${worker_override_dir}" == "${default_run_dir}" ]]; then
  fail "E2E_OUTBOX_WORKER_PORT override still uses ${worker_override_dir}"
elif [[ "${worker_override_dir}" != *"-ow8013-"* ]]; then
  fail "E2E_OUTBOX_WORKER_PORT override dir ${worker_override_dir} does not encode ow8013"
else
  pass "E2E_OUTBOX_WORKER_PORT override isolates RUN_DIR"
fi

edge_override_dir="$(compute_run_dir E2E_EDGE_PORT=3081)"
if [[ "${edge_override_dir}" == "${default_run_dir}" ]]; then
  fail "E2E_EDGE_PORT override still uses ${edge_override_dir}"
elif [[ "${edge_override_dir}" != *"-edge3081" ]]; then
  fail "E2E_EDGE_PORT override dir ${edge_override_dir} does not encode edge3081"
else
  pass "E2E_EDGE_PORT override isolates RUN_DIR"
fi

mailpit_override_dir="$(compute_run_dir E2E_MAILPIT_SMTP_PORT=1027)"
if [[ "${mailpit_override_dir}" == "${default_run_dir}" ]]; then
  fail "E2E_MAILPIT_SMTP_PORT override still uses ${mailpit_override_dir}"
elif [[ "${mailpit_override_dir}" != *"-mp1027-"* ]]; then
  fail "E2E_MAILPIT_SMTP_PORT override dir ${mailpit_override_dir} does not encode mp1027"
else
  pass "E2E_MAILPIT_SMTP_PORT override isolates RUN_DIR"
fi

image_override_dir="$(compute_run_dir E2E_IMAGE_SERVER_PORT=8210)"
if [[ "${image_override_dir}" == "${default_run_dir}" ]]; then
  fail "E2E_IMAGE_SERVER_PORT override still uses ${image_override_dir}"
elif [[ "${image_override_dir}" != *"-img8210-"* ]]; then
  fail "E2E_IMAGE_SERVER_PORT override dir ${image_override_dir} does not encode img8210"
else
  pass "E2E_IMAGE_SERVER_PORT override isolates RUN_DIR"
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

# Teardown deletes the lease file, so a holder that outlives it can no longer be
# named and every later run is refused with nothing to act on.
lock_file="${E2E_DIR}/.run/locks/${lock_project}.lock"
lease_file="${E2E_DIR}/.run/locks/${lock_project}.lease"

# Reports its own failure so a stuck lock ends the check instead of the script.
take_lease() {
  if stack_env E2E_RUN_DIR="$1" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
    source "$1"
    acquire_e2e_lock
  ' bash "${LIB}" >"${lock_err}" 2>&1; then
    return 0
  fi
  fail "could not take the ${lock_project} lease for $1: $(cat "${lock_err}")"
  return 1
}

lock_is_free() {
  flock -n "${lock_file}" true 2>/dev/null
}

wait_lock_free() {
  local _
  for _ in $(seq 1 30); do
    if lock_is_free; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

if ! command -v flock >/dev/null 2>&1; then
  printf '[e2e] lib_test skip: flock unavailable, lock reclaim checks not run\n'
else
  # The recorded pid must be the only process with the lock open. A `sleep`
  # child would inherit fd 9 and keep the flock after teardown kills the holder.
  if take_lease "${lease_a}"; then
    holder_pid="$(sed -n '2p' "${lease_file}")"
    kill -9 "${holder_pid}" 2>/dev/null || true
    if wait_lock_free; then
      pass "killing the lease holder frees the compose-project lock"
    else
      fail "lock still held after killing holder ${holder_pid} (a child inherited fd 9)"
    fi
    rm -f "${lease_file}"
  fi

  # `task e2e:down` run after the lease file is already gone.
  if take_lease "${lease_a}"; then
    orphan_pid="$(sed -n '2p' "${lease_file}")"
    rm -f "${lease_file}"
    if stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      require_e2e_owner_or_free
      release_e2e_lease
    ' bash "${LIB}" >"${lock_err}" 2>&1 && lock_is_free; then
      pass "down reclaims a lock holder orphaned by a missing lease file"
    else
      fail "orphaned holder ${orphan_pid} survived down: $(cat "${lock_err}")"
    fi

    if stack_env E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      acquire_e2e_lock
      release_e2e_lease
    ' bash "${LIB}"; then
      pass "the next run acquires the lock after down reclaimed the orphan"
    else
      fail "acquire still refused after down reclaimed the orphan"
    fi
  fi

  # Acquire never reclaims — a holder may be mid-startup with its lease file not
  # yet written — so the refusal has to hand over the pid and the way out.
  if take_lease "${lease_a}"; then
    stuck_pid="$(sed -n '2p' "${lease_file}")"
    rm -f "${lease_file}"
    if stack_env E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      acquire_e2e_lock
    ' bash "${LIB}" >"${lock_err}" 2>&1; then
      fail "acquire succeeded while an orphaned holder still held the lock"
    elif grep -q "held by pid(s) .*${stuck_pid}" "${lock_err}" && grep -q "task e2e:down" "${lock_err}"; then
      pass "acquire refusal names the orphaned holder and the recovery command"
    else
      fail "acquire refusal does not identify the holder: $(cat "${lock_err}")"
    fi
    stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      release_e2e_lease
    ' bash "${LIB}" >/dev/null 2>&1 || true
  fi

  # Reached through a symlinked repository path, E2E_LOCK_FILE keeps the logical
  # path while /proc reports the physical one. The holder must still be found.
  link_project="${lock_project}-link"
  link_root="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-link.XXXXXX")"
  ln -s "${E2E_DIR}" "${link_root}/e2e"
  if stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${link_project}" bash -c '
    source "$1"
    acquire_e2e_lock
    rm -f "${E2E_LEASE_FILE}"
    release_e2e_lease
  ' bash "${link_root}/e2e/scripts/lib.sh" >"${lock_err}" 2>&1; then
    pass "orphan reclaim works through a symlinked repository path"
  else
    fail "symlinked repository path could not reclaim: $(cat "${lock_err}")"
    stack_env E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${link_project}" bash -c '
      source "$1"
      release_e2e_lease
    ' bash "${LIB}" >/dev/null 2>&1 || true
  fi
  rm -rf "${link_root}"
  rm -f "${E2E_DIR}/.run/locks/${link_project}.lock" "${E2E_DIR}/.run/locks/${link_project}.lease"
fi

trap - EXIT
cleanup_lease

if ((failures > 0)); then
  printf '[e2e] ERROR: lib_test failed (%s)\n' "${failures}" >&2
  exit 1
fi

printf '[e2e] lib_test passed\n'
