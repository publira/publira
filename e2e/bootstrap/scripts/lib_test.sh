#!/usr/bin/env bash
# Fast checks for the stop that phase 3 waits on, with `compose` stubbed.
# No Docker. Invoked from run.sh so a restart cannot go back to issuing `up`
# while the daemon still reports the container as running.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

failures=0
fail() {
  printf '[bootstrap] lib_test FAIL: %s\n' "$*" >&2
  failures=$((failures + 1))
}

pass() {
  printf '[bootstrap] lib_test ok: %s\n' "$*"
}

test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

poll_count_file="${test_dir}/poll-count"
STUB_RUNNING_POLLS=0

# Stands in for the real `compose`: the `--status` listing is the one
# wait_until_stopped polls, every other listing is service_states. Both are read
# in a subshell, so the poll count lives in a file.
compose() {
  local polls
  if [[ "$*" == *--status* ]]; then
    polls=$(($(cat "${poll_count_file}") + 1))
    printf '%s' "${polls}" > "${poll_count_file}"
    if ((polls <= STUB_RUNNING_POLLS)); then
      printf 'db\n'
    fi
    return 0
  fi
  if (($(cat "${poll_count_file}") < STUB_RUNNING_POLLS)); then
    printf 'rustfs=exited\ndb=running\n'
    return 0
  fi
  printf 'rustfs=exited\ndb=exited\n'
}

reset_stub() {
  STUB_RUNNING_POLLS="$1"
  printf '0' > "${poll_count_file}"
}

PUBLIRA_BOOTSTRAP_STOP_INTERVAL_SEC=0.05

reset_stub 0
if wait_until_stopped db rustfs > "${test_dir}/stopped.log" 2>&1; then
  if [[ "$(cat "${poll_count_file}")" == "1" ]]; then
    pass "a stack already down is not polled twice"
  else
    fail "an already stopped stack was polled $(cat "${poll_count_file}") times"
  fi
  if grep -q 'db=exited rustfs=exited' "${test_dir}/stopped.log"; then
    pass "the stop logs the state each service reached"
  else
    fail "the stop log does not name the service states: $(cat "${test_dir}/stopped.log")"
  fi
else
  fail "wait_until_stopped refused a stack that is already down"
fi

reset_stub 3
if wait_until_stopped db rustfs > /dev/null 2>&1; then
  if [[ "$(cat "${poll_count_file}")" == "4" ]]; then
    pass "a service still running is polled until it leaves the running state"
  else
    fail "wait_until_stopped returned after $(cat "${poll_count_file}") polls, want 4"
  fi
else
  fail "wait_until_stopped failed on a service that stopped within the budget"
fi

reset_stub 1000
if (
  PUBLIRA_BOOTSTRAP_STOP_TIMEOUT_SEC=0
  wait_until_stopped db rustfs
) > /dev/null 2> "${test_dir}/timeout.log"; then
  fail "wait_until_stopped returned while db was still running"
elif grep -q 'timed out' "${test_dir}/timeout.log" && grep -q 'db=running' "${test_dir}/timeout.log"; then
  pass "a service that never stops fails the phase and names its state"
else
  fail "the timeout does not report the state db was in: $(cat "${test_dir}/timeout.log")"
fi

reset_stub 0
if [[ "$(service_states db rustfs)" == "db=exited rustfs=exited" ]]; then
  pass "service_states reads as one sorted <service>=<state> line"
else
  fail "service_states returned '$(service_states db rustfs)'"
fi

if ((failures > 0)); then
  printf '[bootstrap] ERROR: lib_test failed (%s)\n' "${failures}" >&2
  exit 1
fi

printf '[bootstrap] lib_test passed\n'
