#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

test_dir="$(mktemp -d)"
started_groups=()
cleanup() {
  local pgid
  for pgid in "${started_groups[@]:-}"; do
    [[ -n "${pgid}" ]] || continue
    kill -s KILL -- "-${pgid}" 2>/dev/null || true
  done
  rm -rf "${test_dir}"
}
trap cleanup EXIT

DEV_ENV_HOME="${test_dir}/home"
DEV_ENV_PROFILES_DIR="${DEV_ENV_HOME}/profiles"
DEV_ENV_SELECTION_FILE="${test_dir}/.publira-dev-env"

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$*"
}

dev_env_ensure_home
# alpha and bravo are created the way the Dev Container creates them: without
# the shared development variables, so the profile falls back to the Compose
# service names. charlie is created the way the host does it, with the loopback
# variables from README.md exported.
(
  unset PUBLIRA_DB_URL PUBLIRA_REDIS_URL PUBLIRA_S3_ENDPOINT
  dev_env_write_profile "alpha" 1
  dev_env_write_profile "bravo" 2
)
(
  export PUBLIRA_DB_URL="postgres://postgres:password@127.0.0.1:5432/publira?sslmode=disable"
  export PUBLIRA_REDIS_URL="redis://127.0.0.1:6379"
  export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:9000"
  dev_env_write_profile "charlie" 3
)

alpha_path="$(dev_env_profile_path alpha)"
bravo_path="$(dev_env_profile_path bravo)"
charlie_path="$(dev_env_profile_path charlie)"

for key in PUBLIRA_DB_URL PUBLIRA_CONTENT_STATS_DB_URL PUBLIRA_REDIS_URL PUBLIRA_S3_BUCKET PUBLIRA_COOKIE_SUFFIX PUBLIRA_WEB_HOST_PORT; do
  alpha_value="$(dev_env_profile_value "${alpha_path}" "${key}")"
  bravo_value="$(dev_env_profile_value "${bravo_path}" "${key}")"
  [[ "${alpha_value}" != "${bravo_value}" ]] || fail "${key} is shared by alpha and bravo"
done
pass "two profiles derive isolated database, Redis, bucket, Cookie, and port values"

[[ "$(dev_env_next_slot)" == "4" ]] || fail "next available slot is not 4"
pass "slot allocation avoids active profile slots"

if dev_env_identifier_is_valid "UPPER"; then
  fail "invalid identifier was accepted"
fi
pass "identifier validation rejects unsafe names"

expect_profile_value() {
  local profile_path="$1" key="$2" expected="$3" actual
  actual="$(dev_env_profile_value "${profile_path}" "${key}")"
  [[ "${actual}" == "${expected}" ]] || fail "${key} in ${profile_path##*/} is ${actual}, expected ${expected}"
}

expect_profile_value "${alpha_path}" PUBLIRA_DB_URL "postgres://postgres:password@db:5432/publira_alpha?sslmode=disable"
expect_profile_value "${alpha_path}" PUBLIRA_ADMIN_DB_URL "postgres://publira_admin:adminpass@db:5432/publira_alpha?sslmode=disable"
expect_profile_value "${alpha_path}" PUBLIRA_REDIS_URL "redis://redis:6379/1"
expect_profile_value "${alpha_path}" PUBLIRA_S3_ENDPOINT "http://rustfs:9000"
pass "a profile created without the shared variables addresses the Compose services by name"

expect_profile_value "${charlie_path}" PUBLIRA_DB_URL "postgres://postgres:password@127.0.0.1:5432/publira_charlie?sslmode=disable"
expect_profile_value "${charlie_path}" PUBLIRA_ADMIN_DB_URL "postgres://publira_admin:adminpass@127.0.0.1:5432/publira_charlie?sslmode=disable"
expect_profile_value "${charlie_path}" PUBLIRA_CONTENT_STATS_DB_URL "postgres://publira_content_stats:contentstatspass@127.0.0.1:5432/publira_charlie?sslmode=disable"
expect_profile_value "${charlie_path}" PUBLIRA_REDIS_URL "redis://127.0.0.1:6379/3"
expect_profile_value "${charlie_path}" PUBLIRA_S3_ENDPOINT "http://127.0.0.1:9000"
pass "a profile created with the host loopback variables addresses the services on loopback"

[[ "$(dev_env_url_authority "redis://127.0.0.1" 6379)" == "127.0.0.1:6379" ]] || fail "default port was not appended"
[[ "$(dev_env_url_authority "postgres://u:p@db/publira?sslmode=disable" 5432)" == "db:5432" ]] || fail "userinfo or query was not stripped"
for malformed in "postgres://" "postgres://:5432/publira" "postgres://127.0.0.1:/publira" \
  "postgres://127.0.0.1:not-a-port/publira" "redis://127.0.0.1:0" "redis://127.0.0.1:65536"; do
  if dev_env_url_authority "${malformed}" 5432 >/dev/null; then
    fail "a URL without a host or with a malformed port was accepted: ${malformed}"
  fi
done
pass "URL authority extraction strips userinfo and path, applies the default port, and rejects malformed ports"

expect_admin_url() {
  local profile_path="$1" expected="$2" actual
  actual="$(
    unset PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL
    PUBLIRA_DB_URL="$(dev_env_profile_value "${profile_path}" PUBLIRA_DB_URL)"
    dev_env_postgres_admin_url
  )"
  [[ "${actual}" == "${expected}" ]] || fail "admin URL for ${profile_path##*/} is ${actual}, expected ${expected}"
}

expect_admin_url "${alpha_path}" "postgres://postgres:password@db:5432/postgres?sslmode=disable"
expect_admin_url "${charlie_path}" "postgres://postgres:password@127.0.0.1:5432/postgres?sslmode=disable"
override="$(
  PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL="postgres://admin:secret@10.0.0.1:5433/postgres"
  PUBLIRA_DB_URL="$(dev_env_profile_value "${charlie_path}" PUBLIRA_DB_URL)"
  dev_env_postgres_admin_url
)"
[[ "${override}" == "postgres://admin:secret@10.0.0.1:5433/postgres" ]] || fail "PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL was not honoured"
pass "the administrator connection follows the profile's PostgreSQL host unless overridden"

# The outbox worker rejects key material config.parseEncryption cannot read, and
# a profile that starts with an unusable one only says so in a retry log, long
# after the mail it dropped. Decode it here the way that parser does instead.
[[ "${DEV_ENV_SECRET_ENCRYPTION_KEYS}" == *:* ]] || fail "the development encryption key is not id:key"
encryption_key_id="${DEV_ENV_SECRET_ENCRYPTION_KEYS%%:*}"
encryption_key="${DEV_ENV_SECRET_ENCRYPTION_KEYS#*:}"
[[ "${encryption_key_id}" == "${DEV_ENV_SECRET_ENCRYPTION_PRIMARY_KEY_ID}" ]] ||
  fail "the primary key id names no entry of the development encryption keys"
padded="${encryption_key//-/+}"
padded="${padded//_//}"
while ((${#padded} % 4 != 0)); do
  padded+="="
done
decoded_length="$(printf '%s' "${padded}" | base64 -d 2>/dev/null | wc -c)"
[[ "${decoded_length}" == "32" ]] || fail "the development encryption key decodes to ${decoded_length} bytes, expected 32"
pass "the development encryption key is one AES-256 key named by the primary key id"

# A service is represented by a shell that keeps a `sleep` child, the shape the
# pnpm-launched services have: the recorded pid is not the process a stop has
# to reach. The shell's $0 carries this repository so that the ownership check
# recognizes the group.
fake_service_pgid=""
start_fake_service() {
  local run_dir="$1" process_name="$2"
  shift 2
  mkdir -p "${run_dir}"
  dev_env_start_background "${run_dir}" "${process_name}" "$@"
  fake_service_pgid="$(<"${run_dir}/${process_name}.pid")"
  started_groups+=("${fake_service_pgid}")
}

count_process_group_members() {
  dev_env_process_group_commands "$1" | grep -c . || true
}

wait_for_process_group_members() {
  local pgid="$1" expected="$2" attempt
  for ((attempt = 0; attempt < 100; attempt += 1)); do
    [[ "$(count_process_group_members "${pgid}")" == "${expected}" ]] && return 0
    sleep 0.1
  done
  return 1
}

chain_run_dir="$(dev_env_profile_run_dir chain)"
start_fake_service "${chain_run_dir}" web bash -c 'sleep 300; true' "${REPO_ROOT}/apps/web-host"
chain_pgid="${fake_service_pgid}"
wait_for_process_group_members "${chain_pgid}" 2 || fail "the started service did not reach a process group of its own"
dev_env_stop_profile chain >/dev/null
if dev_env_process_group_is_running "${chain_pgid}"; then
  fail "a descendant of the recorded pid survived the stop"
fi
[[ ! -e "${chain_run_dir}/web.pid" ]] || fail "the pid file of a stopped process was kept"
pass "stopping a profile ends the descendants of the pid it recorded"

finished_run_dir="$(dev_env_profile_run_dir finished)"
start_fake_service "${finished_run_dir}" web bash -c 'sleep 300; true' "${REPO_ROOT}/apps/web-host"
finished_pgid="${fake_service_pgid}"
wait_for_process_group_members "${finished_pgid}" 2 || fail "the started service did not reach a process group of its own"
kill -s KILL -- "-${finished_pgid}"
wait_for_process_group_members "${finished_pgid}" 0 || fail "the killed process group did not exit"
dev_env_stop_profile finished >/dev/null
[[ ! -e "${finished_run_dir}/web.pid" ]] || fail "the pid file of a process that is already gone was kept"
pass "a stop removes the pid file of a process an earlier stop already ended"

printf 'not-a-pid\n' >"${finished_run_dir}/web.pid"
dev_env_stop_profile finished >/dev/null 2>&1
[[ ! -e "${finished_run_dir}/web.pid" ]] || fail "a pid file naming no process was kept"
pass "a pid file that does not name a process is removed"

foreign_run_dir="$(dev_env_profile_run_dir foreign)"
start_fake_service "${foreign_run_dir}" web sleep 300
foreign_pgid="${fake_service_pgid}"
dev_env_stop_profile foreign >/dev/null 2>&1
dev_env_process_group_is_running "${foreign_pgid}" || fail "a process group outside this repository was signalled"
[[ ! -e "${foreign_run_dir}/web.pid" ]] || fail "the pid file of a pid taken over by another process was kept"
kill -s KILL -- "-${foreign_pgid}"
pass "a pid whose process group no longer belongs to this repository is not signalled"
