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
    -u LOCAL_STORAGE_DIR \
    -u COMPOSE_PROJECT_NAME \
    -u E2E_POSTGRES_PORT \
    -u E2E_REDIS_PORT \
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

# Two stacks, two sleep stand-ins. Stopping via stack A's PID dir must not
# touch stack B's process — this is the stopApiServer cross-talk #685 forbids.
sleep 120 &
pid_a=$!
sleep 120 &
pid_b=$!
cleanup_sleeps() {
  kill "${pid_a}" "${pid_b}" 2>/dev/null || true
  wait "${pid_a}" "${pid_b}" 2>/dev/null || true
}
trap cleanup_sleeps EXIT

stack_env E2E_WEB_HOST_PORT=3100 bash -c '
  source "$1"
  ensure_run_dirs
  write_pid api-server "$2"
' bash "${LIB}" "${pid_a}"
stack_env E2E_WEB_HOST_PORT=3200 bash -c '
  source "$1"
  ensure_run_dirs
  write_pid api-server "$2"
' bash "${LIB}" "${pid_b}"

stack_env E2E_WEB_HOST_PORT=3100 bash -c '
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
rm -rf "$(compute_run_dir E2E_WEB_HOST_PORT=3100)" "$(compute_run_dir E2E_WEB_HOST_PORT=3200)"
trap - EXIT

if ! command -v flock >/dev/null 2>&1; then
  pass "flock not available; skip compose-project lock tests"
else
  lock_project="publira-e2e-libtest-$$"
  ready="$(mktemp)"
  holder_log="$(mktemp)"
  lock_err="$(mktemp)"
  stack_env COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
    source "$1"
    acquire_e2e_lock
    printf x >"$2"
    sleep 30
  ' bash "${LIB}" "${ready}" >"${holder_log}" 2>&1 &
  holder=$!
  cleanup_lock() {
    kill "${holder}" 2>/dev/null || true
    wait "${holder}" 2>/dev/null || true
    rm -f "${ready}" "${holder_log}" "${lock_err}"
  }
  trap cleanup_lock EXIT

  waited=0
  while [[ ! -s "${ready}" ]]; do
    if ! kill -0 "${holder}" 2>/dev/null; then
      fail "lock holder exited before acquire: $(cat "${holder_log}")"
      waited=-1
      break
    fi
    if ((waited > 50)); then
      fail "lock holder did not acquire within 5s: $(cat "${holder_log}")"
      waited=-1
      break
    fi
    sleep 0.1
    waited=$((waited + 1))
  done

  if ((waited >= 0)); then
    if stack_env COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      acquire_e2e_lock
    ' bash "${LIB}" >"${lock_err}" 2>&1; then
      fail "second acquire on ${lock_project} succeeded"
    else
      if grep -q "already in use" "${lock_err}"; then
        pass "second acquire on the same compose project is refused"
      else
        fail "second acquire failed without 'already in use': $(cat "${lock_err}")"
      fi
    fi

    if stack_env COMPOSE_PROJECT_NAME="${lock_project}-other" bash -c '
      source "$1"
      acquire_e2e_lock
    ' bash "${LIB}"; then
      pass "distinct COMPOSE_PROJECT_NAME takes its own lock"
    else
      fail "distinct COMPOSE_PROJECT_NAME could not acquire lock"
    fi

    if stack_env E2E_LOCK_HELD=1 COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      acquire_e2e_lock
    ' bash "${LIB}"; then
      pass "E2E_LOCK_HELD=1 skips re-acquire"
    else
      fail "E2E_LOCK_HELD=1 still tried to take the lock"
    fi
  fi

  kill "${holder}" 2>/dev/null || true
  wait "${holder}" 2>/dev/null || true
  trap - EXIT
  rm -f "${ready}" "${holder_log}" "${lock_err}"
  rm -f "${E2E_DIR}/.run/locks/${lock_project}.lock" "${E2E_DIR}/.run/locks/${lock_project}-other.lock"
fi

if ((failures > 0)); then
  printf '[e2e] ERROR: lib_test failed (%s)\n' "${failures}" >&2
  exit 1
fi

printf '[e2e] lib_test passed\n'
