#!/usr/bin/env bash
# Fast checks for PUBLIRA_E2E_RUN_DIR isolation and the compose-project lock.
# No Docker, no compiled binaries. Invoked from run.sh so a regression cannot
# ship as "two stacks share api-server.pid" again.
set -euo pipefail

PUBLIRA_E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${PUBLIRA_E2E_SCRIPTS_DIR}/lib.sh"
PUBLIRA_E2E_DIR="$(cd "${PUBLIRA_E2E_SCRIPTS_DIR}/.." && pwd)"

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
    -u PUBLIRA_E2E_RUN_DIR \
    -u COMPOSE_PROJECT_NAME \
    -u PUBLIRA_E2E_POSTGRES_PORT \
    -u PUBLIRA_E2E_REDIS_PORT \
    -u PUBLIRA_E2E_RUSTFS_PORT \
    -u PUBLIRA_E2E_MAILPIT_SMTP_PORT \
    -u PUBLIRA_E2E_MAILPIT_HTTP_PORT \
    -u PUBLIRA_E2E_MAILPIT_BASE_URL \
    -u PUBLIRA_S3_ENDPOINT \
    -u PUBLIRA_E2E_WEB_HOST_PORT \
    -u PUBLIRA_E2E_WEB_ADMIN_PORT \
    -u PUBLIRA_E2E_WEB_PLATFORM_PORT \
    -u PUBLIRA_E2E_PUBLIC_API_PORT \
    -u PUBLIRA_E2E_PUBLIC_API_GRPC_PORT \
    -u PUBLIRA_E2E_WORKER_PORT \
    -u PUBLIRA_E2E_EMAIL_RENDERER_PORT \
    -u PUBLIRA_E2E_EDGE_PORT \
    -u PUBLIRA_E2E_LOCK_HELD \
    "$@"
}

compute_run_dir() {
  stack_env "$@" bash -c 'source "$1"; printf %s "$PUBLIRA_E2E_RUN_DIR"' bash "${LIB}"
}

default_run_dir="$(compute_run_dir)"
if [[ "${default_run_dir}" == "${PUBLIRA_E2E_DIR}/.run" ]]; then
  pass "default stack keeps e2e/.run"
else
  fail "default PUBLIRA_E2E_RUN_DIR is ${default_run_dir}, want ${PUBLIRA_E2E_DIR}/.run"
fi

host_override_dir="$(compute_run_dir PUBLIRA_E2E_WEB_HOST_PORT=3001)"
if [[ "${host_override_dir}" == "${default_run_dir}" ]]; then
  fail "PUBLIRA_E2E_WEB_HOST_PORT override still uses ${host_override_dir}"
elif [[ "${host_override_dir}" != *"-h3001-"* ]]; then
  fail "PUBLIRA_E2E_WEB_HOST_PORT override dir ${host_override_dir} does not encode h3001"
else
  pass "PUBLIRA_E2E_WEB_HOST_PORT override isolates RUN_DIR"
fi

api_override_dir="$(compute_run_dir PUBLIRA_E2E_PUBLIC_API_PORT=8010)"
if [[ "${api_override_dir}" == "${default_run_dir}" ]]; then
  fail "PUBLIRA_E2E_PUBLIC_API_PORT override still uses ${api_override_dir}"
else
  pass "PUBLIRA_E2E_PUBLIC_API_PORT override isolates RUN_DIR"
fi

worker_override_dir="$(compute_run_dir PUBLIRA_E2E_WORKER_PORT=8013)"
if [[ "${worker_override_dir}" == "${default_run_dir}" ]]; then
  fail "PUBLIRA_E2E_WORKER_PORT override still uses ${worker_override_dir}"
elif [[ "${worker_override_dir}" != *"-w8013-"* ]]; then
  fail "PUBLIRA_E2E_WORKER_PORT override dir ${worker_override_dir} does not encode w8013"
else
  pass "PUBLIRA_E2E_WORKER_PORT override isolates RUN_DIR"
fi

edge_override_dir="$(compute_run_dir PUBLIRA_E2E_EDGE_PORT=3081)"
if [[ "${edge_override_dir}" == "${default_run_dir}" ]]; then
  fail "PUBLIRA_E2E_EDGE_PORT override still uses ${edge_override_dir}"
elif [[ "${edge_override_dir}" != *"-edge3081" ]]; then
  fail "PUBLIRA_E2E_EDGE_PORT override dir ${edge_override_dir} does not encode edge3081"
else
  pass "PUBLIRA_E2E_EDGE_PORT override isolates RUN_DIR"
fi

mailpit_override_dir="$(compute_run_dir PUBLIRA_E2E_MAILPIT_SMTP_PORT=1027)"
if [[ "${mailpit_override_dir}" == "${default_run_dir}" ]]; then
  fail "PUBLIRA_E2E_MAILPIT_SMTP_PORT override still uses ${mailpit_override_dir}"
elif [[ "${mailpit_override_dir}" != *"-mp1027-"* ]]; then
  fail "PUBLIRA_E2E_MAILPIT_SMTP_PORT override dir ${mailpit_override_dir} does not encode mp1027"
else
  pass "PUBLIRA_E2E_MAILPIT_SMTP_PORT override isolates RUN_DIR"
fi

renderer_override_dir="$(compute_run_dir PUBLIRA_E2E_EMAIL_RENDERER_PORT=8310)"
if [[ "${renderer_override_dir}" == "${default_run_dir}" ]]; then
  fail "PUBLIRA_E2E_EMAIL_RENDERER_PORT override still uses ${renderer_override_dir}"
elif [[ "${renderer_override_dir}" != *"-er8310-"* ]]; then
  fail "PUBLIRA_E2E_EMAIL_RENDERER_PORT override dir ${renderer_override_dir} does not encode er8310"
else
  pass "PUBLIRA_E2E_EMAIL_RENDERER_PORT override isolates RUN_DIR"
fi

project_override_dir="$(compute_run_dir COMPOSE_PROJECT_NAME=publira-e2e-alt)"
if [[ "${project_override_dir}" == "${default_run_dir}" ]]; then
  fail "COMPOSE_PROJECT_NAME override still uses ${project_override_dir}"
elif [[ "${project_override_dir}" != *"/publira-e2e-alt-"* ]]; then
  fail "COMPOSE_PROJECT_NAME override dir ${project_override_dir} does not encode project"
else
  pass "COMPOSE_PROJECT_NAME override isolates RUN_DIR"
fi

explicit_dir="$(compute_run_dir PUBLIRA_E2E_RUN_DIR=/tmp/publira-e2e-explicit PUBLIRA_E2E_WEB_HOST_PORT=3001)"
if [[ "${explicit_dir}" == "/tmp/publira-e2e-explicit" ]]; then
  pass "explicit PUBLIRA_E2E_RUN_DIR wins over port overrides"
else
  fail "explicit PUBLIRA_E2E_RUN_DIR became ${explicit_dir}"
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

port_redis="$(compute_redis_url PUBLIRA_E2E_REDIS_PORT=6381 PUBLIRA_REDIS_URL=redis://redis:6379)"
if [[ "${port_redis}" == "redis://127.0.0.1:6381" ]]; then
  pass "PUBLIRA_E2E_REDIS_PORT drives PUBLIRA_REDIS_URL"
else
  fail "PUBLIRA_E2E_REDIS_PORT=6381 produced PUBLIRA_REDIS_URL=${port_redis}"
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

port_s3_endpoint="$(compute_s3_endpoint PUBLIRA_E2E_RUSTFS_PORT=9004 PUBLIRA_S3_ENDPOINT=http://rustfs:9000)"
if [[ "${port_s3_endpoint}" == "http://127.0.0.1:9004" ]]; then
  pass "PUBLIRA_E2E_RUSTFS_PORT drives PUBLIRA_S3_ENDPOINT"
else
  fail "PUBLIRA_E2E_RUSTFS_PORT=9004 produced PUBLIRA_S3_ENDPOINT=${port_s3_endpoint}"
fi

# App teardown. Dedicated temp RUN_DIRs so this never overwrites a live
# stack's pid files (run.sh invokes us before locking).
pid_root="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-pids.XXXXXX")"
started_groups=()
cleanup_groups() {
  local pgid
  for pgid in "${started_groups[@]}"; do
    kill -s KILL -- "-${pgid}" 2> /dev/null || true
  done
  rm -rf "${pid_root}"
}
trap cleanup_groups EXIT

# Runs lib.sh functions against the RUN_DIR named by the first argument.
in_run_dir() {
  local run_dir="$1"
  shift
  stack_env PUBLIRA_E2E_RUN_DIR="${pid_root}/${run_dir}" bash -c '
    source "$1"
    ensure_run_dirs
    shift
    eval "$@"
  ' bash "${LIB}" "$@"
}

# Starts a stand-in app and sets stand_in_pgid to the process group it runs in.
start_stand_in() {
  local run_dir="$1" name="$2"
  shift 2
  in_run_dir "${run_dir}" "$(printf '%q ' start_process_group "${name}" "${pid_root}" "${pid_root}/${name}.log" "$@")"
  stand_in_pgid="$(sed -n '1p' "${pid_root}/${run_dir}/pids/${name}.pid")"
  started_groups+=("${stand_in_pgid}")
}

group_alive() {
  kill -0 -- "-$1" 2> /dev/null
}

wait_for_group_size() {
  local pgid="$1" expected="$2" _
  for _ in $(seq 1 100); do
    [[ "$(ps -A -o pgid= | awk -v pgid="${pgid}" '$1 == pgid' | grep -c .)" == "${expected}" ]] && return 0
    sleep 0.1
  done
  return 1
}

port_listening() {
  ss -ltn 2> /dev/null | grep -qE ":$1\\b"
}

# Two stacks, two stand-ins: one stack's teardown must not reach the other's.
start_stand_in a app sleep 120
pgid_a="${stand_in_pgid}"
start_stand_in b app sleep 120
pgid_b="${stand_in_pgid}"
in_run_dir a stop_pid_file app > /dev/null 2>&1 || true
if group_alive "${pgid_a}"; then
  fail "stack A stand-in (group ${pgid_a}) still running after stop"
else
  pass "stop_pid_file kills only the matching RUN_DIR process"
fi
if group_alive "${pgid_b}"; then
  pass "stop_pid_file leaves the other RUN_DIR process running"
else
  fail "stack B stand-in (group ${pgid_b}) was stopped by stack A"
fi

# The dev-mode shape: the recorded pid forks the process that holds the port,
# the way `next dev` forks `next-server`.
listen_port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
listener="import socket, time; s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', ${listen_port})); s.listen(); time.sleep(300)"
start_stand_in chain web-host bash -c 'python3 -c "$1" & wait' bash "${listener}"
pgid_chain="${stand_in_pgid}"
wait_for_group_size "${pgid_chain}" 2 || fail "the forking stand-in did not reach two processes"
for _ in $(seq 1 50); do
  port_listening "${listen_port}" && break
  sleep 0.1
done
port_listening "${listen_port}" || fail "the forked stand-in never listened on ${listen_port}"
in_run_dir chain stop_pid_file web-host > /dev/null 2>&1 || true
if group_alive "${pgid_chain}"; then
  fail "a descendant of the recorded pid survived the stop"
elif port_listening "${listen_port}"; then
  fail "port ${listen_port} is still listening after the stop"
else
  pass "stop_pid_file ends the descendants of the recorded pid and frees their port"
fi
[[ ! -e "${pid_root}/chain/pids/web-host.pid" ]] || fail "the pid file of a stopped app was kept"

# The recorded pid has exited and its child still runs under the same group.
start_stand_in orphan app bash -c 'sleep 300 & exit 0'
pgid_orphan="${stand_in_pgid}"
wait_for_group_size "${pgid_orphan}" 1 || fail "the stand-in leader did not exit"
in_run_dir orphan stop_pid_file app > /dev/null 2>&1 || true
if group_alive "${pgid_orphan}"; then
  fail "a descendant outlived the stop after the recorded pid had exited"
else
  pass "stop_pid_file ends the group after the recorded pid has exited"
fi

# A group the signals cannot end keeps its pid file, so a repeated teardown can
# finish it.
start_stand_in stubborn app sleep 120
pgid_stubborn="${stand_in_pgid}"
if in_run_dir stubborn 'kill() { [[ "$1" == "-0" ]] && builtin kill "$@"; }; wait_for_process_group_exit() { false; }; stop_pid_file app' > /dev/null 2>&1; then
  fail "stop_pid_file reported success while the group survived"
fi
if [[ -e "${pid_root}/stubborn/pids/app.pid" ]] && group_alive "${pgid_stubborn}"; then
  pass "a group that survives the stop keeps its pid file"
else
  fail "the pid file of a surviving group was removed"
fi
in_run_dir stubborn stop_pid_file app > /dev/null 2>&1 || true
if group_alive "${pgid_stubborn}" || [[ -e "${pid_root}/stubborn/pids/app.pid" ]]; then
  fail "a repeated stop did not finish what the first one left"
else
  pass "a repeated stop finishes an incomplete one"
fi

# A pid file whose start time no longer matches names a reused pid.
start_stand_in reused app sleep 120
pgid_reused="${stand_in_pgid}"
printf '%s\n%s\n' "${pgid_reused}" "Thu Jan  1 00:00:00 1970" > "${pid_root}/reused/pids/app.pid"
in_run_dir reused stop_pid_file app > /dev/null 2>&1 || true
if group_alive "${pgid_reused}"; then
  pass "stop_pid_file does not signal a group whose leader was started at another time"
else
  fail "stop_pid_file signalled a reused pid"
fi
[[ ! -e "${pid_root}/reused/pids/app.pid" ]] || fail "the pid file of a reused pid was kept"

trap - EXIT
cleanup_groups

# Lease outlives the acquiring shell (up.sh exits, stack stays). A foreign
# PUBLIRA_E2E_RUN_DIR must not acquire or release; the owner leftover down may.
lock_project="publira-e2e-libtest-$$"
lease_root="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-lease.XXXXXX")"
lease_a="${lease_root}/a"
lease_b="${lease_root}/b"
lock_err="$(mktemp)"
cleanup_lease() {
  stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
    source "$1"
    release_e2e_lease || true
  ' bash "${LIB}" > /dev/null 2>&1 || true
  stack_env PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}-other" bash -c '
    source "$1"
    release_e2e_lease || true
  ' bash "${LIB}" > /dev/null 2>&1 || true
  rm -rf "${lease_root}"
  rm -f "${lock_err}"
  rm -f "${PUBLIRA_E2E_DIR}/.run/locks/${lock_project}.lock" "${PUBLIRA_E2E_DIR}/.run/locks/${lock_project}.lease"
  rm -f "${PUBLIRA_E2E_DIR}/.run/locks/${lock_project}-other.lock" "${PUBLIRA_E2E_DIR}/.run/locks/${lock_project}-other.lease"
}
trap cleanup_lease EXIT

if ! stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}"; then
  fail "owner acquire did not start a lease holder"
else
  pass "acquire starts a lease holder that outlives the shell"
fi

if stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}"; then
  pass "same PUBLIRA_E2E_RUN_DIR joins the leftover lease"
else
  fail "owner leftover acquire (up then start-apps) was refused"
fi

if stack_env PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}" > "${lock_err}" 2>&1; then
  fail "foreign PUBLIRA_E2E_RUN_DIR acquire succeeded after owner up"
else
  if grep -q "already in use" "${lock_err}"; then
    pass "foreign PUBLIRA_E2E_RUN_DIR acquire is refused while the stack lease lives"
  else
    fail "foreign acquire failed without 'already in use': $(cat "${lock_err}")"
  fi
fi

if stack_env PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  require_e2e_owner_or_free
  release_e2e_lease
' bash "${LIB}" > "${lock_err}" 2>&1; then
  fail "foreign down/release succeeded after owner up"
else
  if grep -q "already in use" "${lock_err}"; then
    pass "foreign down is refused after up.sh exits"
  else
    fail "foreign down failed without 'already in use': $(cat "${lock_err}")"
  fi
fi

if stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  require_e2e_owner_or_free
  release_e2e_lease
' bash "${LIB}"; then
  pass "owner leftover down releases the lease"
else
  fail "owner leftover down was refused"
fi

if stack_env PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}-other" bash -c '
  source "$1"
  acquire_e2e_lock
  release_e2e_lease
' bash "${LIB}"; then
  pass "distinct COMPOSE_PROJECT_NAME takes its own lease"
else
  fail "distinct COMPOSE_PROJECT_NAME could not acquire lease"
fi

if stack_env PUBLIRA_E2E_LOCK_HELD=1 PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
  source "$1"
  acquire_e2e_lock
' bash "${LIB}"; then
  pass "PUBLIRA_E2E_LOCK_HELD=1 skips re-acquire"
else
  fail "PUBLIRA_E2E_LOCK_HELD=1 still tried to take the lease"
fi

# Teardown deletes the lease file, so a holder that outlives it can no longer be
# named and every later run is refused with nothing to act on.
lock_file="${PUBLIRA_E2E_DIR}/.run/locks/${lock_project}.lock"
lease_file="${PUBLIRA_E2E_DIR}/.run/locks/${lock_project}.lease"

# Reports its own failure so a stuck lock ends the check instead of the script.
take_lease() {
  if stack_env PUBLIRA_E2E_RUN_DIR="$1" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
    source "$1"
    acquire_e2e_lock
  ' bash "${LIB}" > "${lock_err}" 2>&1; then
    return 0
  fi
  fail "could not take the ${lock_project} lease for $1: $(cat "${lock_err}")"
  return 1
}

lock_is_free() {
  flock -n "${lock_file}" true 2> /dev/null
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

if ! command -v flock > /dev/null 2>&1; then
  printf '[e2e] lib_test skip: flock unavailable, lock reclaim checks not run\n'
else
  # The recorded pid must be the only process with the lock open. A `sleep`
  # child would inherit fd 9 and keep the flock after teardown kills the holder.
  if take_lease "${lease_a}"; then
    holder_pid="$(sed -n '2p' "${lease_file}")"
    kill -9 "${holder_pid}" 2> /dev/null || true
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
    if stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      require_e2e_owner_or_free
      release_e2e_lease
    ' bash "${LIB}" > "${lock_err}" 2>&1 && lock_is_free; then
      pass "down reclaims a lock holder orphaned by a missing lease file"
    else
      fail "orphaned holder ${orphan_pid} survived down: $(cat "${lock_err}")"
    fi

    if stack_env PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
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
    if stack_env PUBLIRA_E2E_RUN_DIR="${lease_b}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      acquire_e2e_lock
    ' bash "${LIB}" > "${lock_err}" 2>&1; then
      fail "acquire succeeded while an orphaned holder still held the lock"
    elif grep -q "held by pid(s) .*${stuck_pid}" "${lock_err}" && grep -q "task e2e:down" "${lock_err}"; then
      pass "acquire refusal names the orphaned holder and the recovery command"
    else
      fail "acquire refusal does not identify the holder: $(cat "${lock_err}")"
    fi
    stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${lock_project}" bash -c '
      source "$1"
      release_e2e_lease
    ' bash "${LIB}" > /dev/null 2>&1 || true
  fi

  # Reached through a symlinked repository path, PUBLIRA_E2E_LOCK_FILE keeps the logical
  # path while /proc reports the physical one. The holder must still be found.
  link_project="${lock_project}-link"
  link_root="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-link.XXXXXX")"
  ln -s "${PUBLIRA_E2E_DIR}" "${link_root}/e2e"
  if stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${link_project}" bash -c '
    source "$1"
    acquire_e2e_lock
    rm -f "${PUBLIRA_E2E_LEASE_FILE}"
    release_e2e_lease
  ' bash "${link_root}/e2e/scripts/lib.sh" > "${lock_err}" 2>&1; then
    pass "orphan reclaim works through a symlinked repository path"
  else
    fail "symlinked repository path could not reclaim: $(cat "${lock_err}")"
    stack_env PUBLIRA_E2E_RUN_DIR="${lease_a}" COMPOSE_PROJECT_NAME="${link_project}" bash -c '
      source "$1"
      release_e2e_lease
    ' bash "${LIB}" > /dev/null 2>&1 || true
  fi
  rm -rf "${link_root}"
  rm -f "${PUBLIRA_E2E_DIR}/.run/locks/${link_project}.lock" "${PUBLIRA_E2E_DIR}/.run/locks/${link_project}.lease"
fi

# A stack outlives its lease holder: kill the holder and the containers stay up,
# the ports stay bound, and Postgres keeps answering. Ownership is therefore read
# off the containers too, which a `docker` stand-in on PATH answers for here so
# the check still needs no daemon.
stack_project="${lock_project}-stack"
stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/publira-e2e-libtest-docker.XXXXXX")"
cat > "${stub_dir}/docker" << 'STUB'
#!/usr/bin/env bash
# Answers the two `docker ps` queries lib.sh makes. STUB_STACK_PRESENT=1 gives
# the compose project containers, whose run-directory label is
# STUB_STACK_RUN_DIR — empty for containers these scripts did not create.
# STUB_PORT_PROJECT is the compose project publishing the queried port.
set -euo pipefail
for arg in "$@"; do
  if [[ "${arg}" == publish=* ]]; then
    if [[ -n "${STUB_PORT_PROJECT:-}" ]]; then
      printf '%s\n' "${STUB_PORT_PROJECT}"
    fi
    exit 0
  fi
done
if [[ "${STUB_STACK_PRESENT:-0}" == "1" ]]; then
  printf '%s\n' "${STUB_STACK_RUN_DIR:-}"
fi
STUB
chmod +x "${stub_dir}/docker"

cleanup_stack_checks() {
  cleanup_lease
  rm -rf "${stub_dir}"
  rm -f "${PUBLIRA_E2E_DIR}/.run/locks/${stack_project}.lock" "${PUBLIRA_E2E_DIR}/.run/locks/${stack_project}.lease"
}
trap cleanup_stack_checks EXIT

# acquire_e2e_lock as `task e2e:up` and `task e2e:db` reach it, with the stub
# describing what is up. Extra NAME=value arguments configure that stub.
acquire_with_stub() {
  local run_dir="$1"
  shift
  stack_env \
    PATH="${stub_dir}:${PATH}" \
    PUBLIRA_E2E_RUN_DIR="${run_dir}" \
    COMPOSE_PROJECT_NAME="${stack_project}" \
    "$@" \
    bash -c '
      source "$1"
      acquire_e2e_lock
    ' bash "${LIB}"
}

release_stack_lease() {
  stack_env \
    PATH="${stub_dir}:${PATH}" \
    PUBLIRA_E2E_RUN_DIR="$1" \
    COMPOSE_PROJECT_NAME="${stack_project}" \
    bash -c '
      source "$1"
      release_e2e_lease
    ' bash "${LIB}" > /dev/null 2>&1 || true
}

if acquire_with_stub "${lease_b}" STUB_STACK_PRESENT=1 STUB_STACK_RUN_DIR="${lease_a}" \
  > "${lock_err}" 2>&1; then
  fail "acquire took the project while another run's stack was up"
  release_stack_lease "${lease_b}"
elif grep -q "stack owned by ${lease_a}" "${lock_err}" &&
  grep -q "COMPOSE_PROJECT_NAME and PUBLIRA_E2E_\*_PORT" "${lock_err}"; then
  pass "a running stack with no lease holder refuses a foreign run"
else
  fail "foreign stack refusal does not name the owner and the way out: $(cat "${lock_err}")"
fi

if acquire_with_stub "${lease_b}" STUB_STACK_PRESENT=1 > "${lock_err}" 2>&1; then
  fail "acquire took the project while unlabelled containers were up"
  release_stack_lease "${lease_b}"
elif grep -q "did not create" "${lock_err}" && grep -q "task e2e:down" "${lock_err}"; then
  pass "containers with no run-directory label refuse the run and name the recovery"
else
  fail "unlabelled stack refusal does not point at teardown: $(cat "${lock_err}")"
fi

if acquire_with_stub "${lease_b}" STUB_PORT_PROJECT="${stack_project}-other" \
  > "${lock_err}" 2>&1; then
  fail "acquire took the project while another one published its Postgres port"
  release_stack_lease "${lease_b}"
elif grep -q "port 5433 is published by compose project ${stack_project}-other" "${lock_err}"; then
  pass "a data port published by another compose project refuses the run"
else
  fail "port refusal does not name the port and its project: $(cat "${lock_err}")"
fi

if acquire_with_stub "${lease_a}" STUB_STACK_PRESENT=1 STUB_STACK_RUN_DIR="${lease_a}" \
  > "${lock_err}" 2>&1; then
  pass "the run that owns the stack acquires after its lease holder is gone"
  release_stack_lease "${lease_a}"
else
  fail "owner was refused its own stack: $(cat "${lock_err}")"
fi

if acquire_with_stub "${lease_a}" > "${lock_err}" 2>&1; then
  pass "a run on a project with no stack is unaffected"
  release_stack_lease "${lease_a}"
else
  fail "acquire was refused with no stack up: $(cat "${lock_err}")"
fi

trap - EXIT
cleanup_stack_checks

if ((failures > 0)); then
  printf '[e2e] ERROR: lib_test failed (%s)\n' "${failures}" >&2
  exit 1
fi

printf '[e2e] lib_test passed\n'
