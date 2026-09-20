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
    kill -s KILL -- "-${pgid}" 2> /dev/null || true
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

for key in PUBLIRA_DB_URL PUBLIRA_CONTENT_STATS_DB_URL PUBLIRA_REDIS_URL PUBLIRA_S3_BUCKET PUBLIRA_COOKIE_SUFFIX PUBLIRA_WEB_HOST_PORT PUBLIRA_EDGE_PORT; do
  alpha_value="$(dev_env_profile_value "${alpha_path}" "${key}")"
  bravo_value="$(dev_env_profile_value "${bravo_path}" "${key}")"
  [[ "${alpha_value}" != "${bravo_value}" ]] || fail "${key} is shared by alpha and bravo"
done
pass "two profiles derive isolated database, Redis, bucket, Cookie, and port values"

[[ "$(dev_env_next_slot)" == "4" ]] || fail "next available slot is not 4"
pass "slot allocation avoids active profile slots"

# Stand-ins for the commands the script hands a profile's resources to. The aws
# one answers the way it does for a bucket that was never created, which is the
# state a profile is in when it was created but never initialized.
write_stub() {
  local path="$1" body="$2"
  mkdir -p "$(dirname "${path}")"
  printf '#!/bin/sh\n%s\n' "${body}" > "${path}"
  chmod +x "${path}"
}
no_such_bucket='echo "fatal error: An error occurred (NoSuchBucket) when calling the ListObjectsV2 operation: The specified bucket does not exist" >&2; exit 255'
write_stub "${test_dir}/aws-gone/aws" "${no_such_bucket}"
write_stub "${test_dir}/aws-ok/aws" 'exit 0'
write_stub "${test_dir}/aws-unreachable/aws" 'echo "Could not connect to the endpoint URL" >&2; exit 255'
cli_bin_dir="${test_dir}/cli-bin"
write_stub "${cli_bin_dir}/aws" "${no_such_bucket}"
write_stub "${cli_bin_dir}/psql" 'exit 0'
write_stub "${cli_bin_dir}/valkey-cli" 'exit 0'
unflushable_bin_dir="${test_dir}/cli-bin-unflushable"
write_stub "${unflushable_bin_dir}/valkey-cli" 'echo "Could not connect to Valkey" >&2; exit 1'

(PATH="${test_dir}/aws-ok:${PATH}" dev_env_remove_bucket publira-present http://127.0.0.1:9000) ||
  fail "removing a bucket that is there was reported as a failure"
(PATH="${test_dir}/aws-gone:${PATH}" dev_env_remove_bucket publira-gone http://127.0.0.1:9000) ||
  fail "removing a bucket that is already gone was reported as a failure"
if unreachable_message="$( (PATH="${test_dir}/aws-unreachable:${PATH}" dev_env_remove_bucket publira-present http://127.0.0.1:9000) 2>&1)"; then
  fail "removing a bucket succeeded where the endpoint could not be reached"
fi
[[ "${unreachable_message}" == *"Could not connect"* ]] ||
  fail "the reason a bucket could not be removed was not passed on: ${unreachable_message}"
pass "removing a bucket treats one that is already gone as done and passes any other failure on"

# A slot table with every slot held, kept in a home of its own so that the
# profiles above go on standing for a table with slots to spare.
full_home="${test_dir}/full-home"
(
  DEV_ENV_PROFILES_DIR="${full_home}/profiles"
  mkdir -p "${DEV_ENV_PROFILES_DIR}"
  for slot in $(seq "${DEV_ENV_SLOT_MIN}" "${DEV_ENV_SLOT_MAX}"); do
    dev_env_write_profile "held-${slot}" "${slot}"
  done
)
if full_slot="$(
  DEV_ENV_PROFILES_DIR="${full_home}/profiles"
  dev_env_next_slot
)"; then
  fail "a slot was allocated from a table in which every one is held: ${full_slot}"
fi
held_profiles="$(
  DEV_ENV_PROFILES_DIR="${full_home}/profiles"
  dev_env_slot_holders
)"
[[ "$(printf '%s\n' "${held_profiles}" | wc -l)" == "${DEV_ENV_SLOT_MAX}" ]] ||
  fail "the profiles holding the slots were not all named"
[[ "$(printf '%s\n' "${held_profiles}" | head -1)" == "held-1 (slot 1)" ]] ||
  fail "the slot holders are not listed in slot order"
[[ "$(printf '%s\n' "${held_profiles}" | tail -1)" == "held-${DEV_ENV_SLOT_MAX} (slot ${DEV_ENV_SLOT_MAX})" ]] ||
  fail "the slot holders are not listed in slot order"
pass "a full slot table yields no slot and names every profile holding one"

for refused_slot in "" 0 "$((DEV_ENV_SLOT_MAX + 1))" 18446744073709551617; do
  if (dev_env_write_profile "slotless" "${refused_slot}") > /dev/null 2>&1; then
    fail "a profile was written with slot '${refused_slot}'"
  fi
  [[ ! -e "$(dev_env_profile_path slotless)" ]] ||
    fail "a profile file was left behind for slot '${refused_slot}'"
done
pass "a profile is never written without a Valkey logical database of its own"

if create_output="$(
  PUBLIRA_DEV_ENV_HOME="${full_home}" PATH="${cli_bin_dir}:${PATH}" \
    bash "${REPO_ROOT}/scripts/dev-env.sh" create sixteenth 2>&1
)"; then
  fail "creating a profile succeeded with every Valkey slot held"
fi
[[ ! -e "${full_home}/profiles/sixteenth.env" ]] || fail "a profile file was written with no slot to give it"
[[ "${create_output}" == *"held-1 (slot 1)"* ]] ||
  fail "the profiles to destroy were not named: ${create_output}"
pass "creating a profile with every slot held fails, writes nothing, and says what holds them"

# A create that succeeds selects its profile in the checkout the script runs
# from, so these run from a copy of the scripts rather than from this worktree.
create_root="${test_dir}/create-root"
mkdir -p "${create_root}/scripts/dev-env"
cp "${REPO_ROOT}/scripts/dev-env.sh" "${create_root}/scripts/dev-env.sh"
cp "${SCRIPT_DIR}/lib.sh" "${create_root}/scripts/dev-env/lib.sh"
concurrent_creates=8

start_create() {
  local home="$1" name="$2" output="$3"
  PUBLIRA_DEV_ENV_HOME="${home}" bash "${create_root}/scripts/dev-env.sh" create "${name}" > "${output}" 2>&1 &
}

distinct_home="${test_dir}/distinct-home"
create_pids=()
for i in $(seq "${concurrent_creates}"); do
  start_create "${distinct_home}" "parallel-${i}" "${test_dir}/distinct-${i}.log"
  create_pids+=("$!")
done
for i in "${!create_pids[@]}"; do
  wait "${create_pids[${i}]}" || fail "a concurrent create failed: $(< "${test_dir}/distinct-$((i + 1)).log")"
done
distinct_slots="$(
  for i in $(seq "${concurrent_creates}"); do
    dev_env_profile_value "${distinct_home}/profiles/parallel-${i}.env" DEV_ENV_SLOT
  done | sort -n | uniq | tr '\n' ' '
)"
[[ "${distinct_slots}" == "$(seq -s ' ' "${concurrent_creates}") " ]] ||
  fail "concurrent creates did not take one slot each: ${distinct_slots}"
pass "concurrent creates with distinct names each take a slot of their own"

same_home="${test_dir}/same-home"
create_pids=()
for i in $(seq "${concurrent_creates}"); do
  start_create "${same_home}" shared "${test_dir}/same-${i}.log"
  create_pids+=("$!")
done
same_created=0
for i in "${!create_pids[@]}"; do
  if wait "${create_pids[${i}]}"; then
    same_created=$((same_created + 1))
  else
    [[ "$(< "${test_dir}/same-$((i + 1)).log")" == *"profile already exists: shared"* ]] ||
      fail "a losing concurrent create did not report the existing profile: $(< "${test_dir}/same-$((i + 1)).log")"
  fi
done
((same_created == 1)) || fail "${same_created} concurrent creates with one name succeeded"
same_profiles=("${same_home}"/profiles/*)
[[ "${#same_profiles[@]}" == 1 && "${same_profiles[0]}" == */shared.env ]] ||
  fail "concurrent creates with one name left ${same_profiles[*]}"
pass "concurrent creates with one name leave one profile and report it to the others"

# A holder killed while it has the lock stands for a create interrupted inside
# it. The create waiting behind it has to go on once the holder is gone.
interrupted_home="${test_dir}/interrupted-home"
mkdir -p "${interrupted_home}/profiles"
set -m
PUBLIRA_DEV_ENV_HOME="${interrupted_home}" bash -c '
  source "$1"
  dev_env_lock_profiles
  : >"$2"
  sleep 300 9>&-
' _ "${SCRIPT_DIR}/lib.sh" "${test_dir}/holder-ready" &
holder_pgid="$!"
set +m
started_groups+=("${holder_pgid}")
for _ in $(seq 100); do
  [[ -e "${test_dir}/holder-ready" ]] && break
  sleep 0.1
done
[[ -e "${test_dir}/holder-ready" ]] || fail "the lock holder never took the lock"
start_create "${interrupted_home}" waiting "${test_dir}/waiting.log"
waiting_pid="$!"
sleep 1
kill -0 "${waiting_pid}" 2> /dev/null || fail "a create did not wait for the lock: $(< "${test_dir}/waiting.log")"
[[ ! -e "${interrupted_home}/profiles/waiting.env" ]] || fail "a create wrote its profile while the lock was held"
kill -s KILL -- "-${holder_pgid}"
wait "${holder_pgid}" 2> /dev/null || true
for _ in $(seq 100); do
  kill -0 "${waiting_pid}" 2> /dev/null || break
  sleep 0.1
done
if kill -0 "${waiting_pid}" 2> /dev/null; then
  kill -s KILL "${waiting_pid}"
  fail "a create stayed blocked after the lock holder was killed"
fi
wait "${waiting_pid}" || fail "the create behind a killed lock holder failed: $(< "${test_dir}/waiting.log")"
[[ -e "${interrupted_home}/profiles/waiting.env" ]] || fail "the create behind a killed lock holder wrote no profile"
pass "a create waits for the lock and goes on once a holder killed inside it is gone"

if dev_env_identifier_is_valid "UPPER"; then
  fail "invalid identifier was accepted"
fi
pass "identifier validation rejects unsafe names"

# Both Redis-protocol clients are looked up on PATH, so a PATH carrying only
# one of them stands for a shell where only that one is installed.
client_bin_dir="${test_dir}/bin"
empty_bin_dir="${test_dir}/empty-bin"
mkdir -p "${client_bin_dir}" "${empty_bin_dir}"
for client_name in valkey-cli redis-cli; do
  printf '#!/bin/sh\nexit 0\n' > "${client_bin_dir}/${client_name}"
  chmod +x "${client_bin_dir}/${client_name}"
done

[[ "$(PATH="${client_bin_dir}" dev_env_redis_cli)" == "valkey-cli" ]] ||
  fail "Valkey's own client was not preferred where both clients are installed"
mkdir -p "${client_bin_dir}/redis-only"
mv "${client_bin_dir}/redis-cli" "${client_bin_dir}/redis-only/redis-cli"
[[ "$(PATH="${client_bin_dir}/redis-only" dev_env_redis_cli)" == "redis-cli" ]] ||
  fail "Redis's client was not used where it is the only one installed"
if (PATH="${empty_bin_dir}" dev_env_redis_cli) > /dev/null; then
  fail "resolving a client succeeded where neither is installed"
fi
pass "the Redis-protocol client is whichever of Valkey's and Redis's is installed"

if missing_message="$( (PATH="${client_bin_dir}" dev_env_require_commands valkey-cli not-an-installed-command) 2>&1)"; then
  fail "a command that is not installed was accepted"
fi
[[ "${missing_message}" == *"not-an-installed-command"* ]] ||
  fail "the missing command was not named: ${missing_message}"
(PATH="${client_bin_dir}" dev_env_require_commands valkey-cli) ||
  fail "a command that is installed was reported as missing"
pass "required commands are checked by name and the first missing one is reported"

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

expect_profile_value "${charlie_path}" PUBLIRA_TICKER_DB_URL "postgres://publira_ticker:tickerpass@127.0.0.1:5432/publira_charlie?sslmode=disable"
pass "a new profile points the ticker jobs at their own login"

expect_profile_value "${alpha_path}" PUBLIRA_EDGE_PORT "13150"
expect_profile_value "${alpha_path}" PUBLIRA_PLATFORM_APP_URL "http://platform.localhost:13150"
pass "a new profile carries the port of an edge of its own and names the platform console by it"

# A profile written before it had an edge carries neither the port of one nor a
# platform URL that goes through it. Loading it must answer both, because a
# profile that cannot route /images serves no image at all.
(
  export PUBLIRA_DB_URL="postgres://postgres:password@127.0.0.1:5432/publira?sslmode=disable"
  export PUBLIRA_REDIS_URL="redis://127.0.0.1:6379"
  export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:9000"
  dev_env_write_profile "echo" 5
)
echo_path="$(dev_env_profile_path echo)"
grep -v '^PUBLIRA_EDGE_PORT=' "${echo_path}" |
  sed 's|^PUBLIRA_PLATFORM_APP_URL=.*$|PUBLIRA_PLATFORM_APP_URL=http://platform.localhost:13502|' \
    > "${echo_path}.before-the-edge"
mv "${echo_path}.before-the-edge" "${echo_path}"
echo_edge="$(
  dev_env_load_profile echo > /dev/null
  printf '%s %s\n' "${PUBLIRA_EDGE_PORT}" "${PUBLIRA_PLATFORM_APP_URL}"
)"
[[ "${echo_edge}" == "13550 http://platform.localhost:13550" ]] ||
  fail "a profile written before the edge resolved to ${echo_edge}"

# A platform URL a developer pointed elsewhere is not one this script wrote,
# so the repair above leaves it alone.
sed -i 's|^PUBLIRA_PLATFORM_APP_URL=.*$|PUBLIRA_PLATFORM_APP_URL=http://platform.example.com|' "${echo_path}"
echo_platform_url="$(
  dev_env_load_profile echo > /dev/null
  printf '%s\n' "${PUBLIRA_PLATFORM_APP_URL}"
)"
[[ "${echo_platform_url}" == "http://platform.example.com" ]] ||
  fail "a platform URL pointed elsewhere became ${echo_platform_url}"
rm -f "${echo_path}"
pass "a profile written before the edge takes its port and its platform URL from the ports it holds"

# A profile written before the ticker jobs had a login of their own carries no
# PUBLIRA_TICKER_DB_URL. Loading it must still not put those jobs on the
# superuser connection, which is the whole defect the dedicated role removes.
(
  export PUBLIRA_DB_URL="postgres://postgres:password@127.0.0.1:5432/publira?sslmode=disable"
  export PUBLIRA_REDIS_URL="redis://127.0.0.1:6379"
  export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:9000"
  dev_env_write_profile "delta" 4
)
delta_path="$(dev_env_profile_path delta)"
grep -v '^PUBLIRA_TICKER_DB_URL=' "${delta_path}" > "${delta_path}.without-ticker"
mv "${delta_path}.without-ticker" "${delta_path}"
delta_ticker_url="$(
  dev_env_load_profile delta > /dev/null
  printf '%s\n' "${PUBLIRA_TICKER_DB_URL}"
)"
[[ "${delta_ticker_url}" == "postgres://publira_ticker:tickerpass@127.0.0.1:5432/publira_delta?sslmode=disable" ]] ||
  fail "a profile with no ticker URL resolved to ${delta_ticker_url}"
rm -f "${delta_path}"
pass "a profile written before the ticker role still loads that role's login, never the superuser connection"

[[ "$(dev_env_url_authority "redis://127.0.0.1" 6379)" == "127.0.0.1:6379" ]] || fail "default port was not appended"
[[ "$(dev_env_url_authority "postgres://u:p@db/publira?sslmode=disable" 5432)" == "db:5432" ]] || fail "userinfo or query was not stripped"
for malformed in "postgres://" "postgres://:5432/publira" "postgres://127.0.0.1:/publira" \
  "postgres://127.0.0.1:not-a-port/publira" "redis://127.0.0.1:0" "redis://127.0.0.1:65536"; do
  if dev_env_url_authority "${malformed}" 5432 > /dev/null; then
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

# The worker rejects key material config.parseEncryption cannot read, and a
# profile that starts with an unusable one only says so in a retry log, long
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
decoded_length="$(printf '%s' "${padded}" | base64 -d 2> /dev/null | wc -c)"
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
  fake_service_pgid="$(< "${run_dir}/${process_name}.pid")"
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
dev_env_stop_profile chain > /dev/null
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
dev_env_stop_profile finished > /dev/null
[[ ! -e "${finished_run_dir}/web.pid" ]] || fail "the pid file of a process that is already gone was kept"
pass "a stop removes the pid file of a process an earlier stop already ended"

printf 'not-a-pid\n' > "${finished_run_dir}/web.pid"
dev_env_stop_profile finished > /dev/null 2>&1
[[ ! -e "${finished_run_dir}/web.pid" ]] || fail "a pid file naming no process was kept"
pass "a pid file that does not name a process is removed"

foreign_run_dir="$(dev_env_profile_run_dir foreign)"
start_fake_service "${foreign_run_dir}" web sleep 300
foreign_pgid="${fake_service_pgid}"
dev_env_stop_profile foreign > /dev/null 2>&1
dev_env_process_group_is_running "${foreign_pgid}" || fail "a process group outside this repository was signalled"
[[ ! -e "${foreign_run_dir}/web.pid" ]] || fail "the pid file of a pid taken over by another process was kept"
kill -s KILL -- "-${foreign_pgid}"
pass "a pid whose process group no longer belongs to this repository is not signalled"

# The run directory outlives the run: `dev_env_stop_profile` removes the pid
# files and then cannot `rmdir` a directory that still holds the logs. Reading
# the directory would therefore call every profile that has ever been started a
# running one.
logged_run_dir="$(dev_env_profile_run_dir logged)"
start_fake_service "${logged_run_dir}" web bash -c 'sleep 300; true' "${REPO_ROOT}/apps/web-host"
dev_env_profile_has_running_processes logged || fail "a profile whose service is running was not reported as running"
dev_env_stop_profile logged > /dev/null
[[ -f "${logged_run_dir}/web.log" ]] || fail "the log of a stopped service was removed"
if dev_env_profile_has_running_processes logged; then
  fail "a stopped profile whose logs are still on disk was reported as running"
fi
pass "a profile is running while a pid file names one of its services, not while its logs remain"

if dev_env_profile_has_running_processes never-started; then
  fail "a profile with no run directory was reported as running"
fi
pass "a profile that was never started is not reported as running"

# The edge has no pid file: it is a container, and the services file it is
# started with stands for it until a stop takes it down. A profile whose edge
# is still up is a running one, because the port that edge holds is the one a
# start would put the next edge on.
edged_services_file="$(dev_env_edge_services_file edged)"
mkdir -p "$(dev_env_profile_run_dir edged)"
: > "${edged_services_file}"
dev_env_profile_has_running_processes edged || fail "a profile whose edge is up was not reported as running"
rm -f "${edged_services_file}"
if dev_env_profile_has_running_processes edged; then
  fail "a profile whose edge is down was reported as running"
fi
pass "a profile is running while its edge is, not only while one of its processes is"

# The destroy the CLI runs, against a profile whose bucket was never created:
# the state every profile that was created but never initialized is in.
(
  unset PUBLIRA_DB_URL PUBLIRA_REDIS_URL PUBLIRA_S3_ENDPOINT
  dev_env_write_profile "golf" 4
)
golf_path="$(dev_env_profile_path golf)"
[[ "$(dev_env_next_slot)" == "5" ]] || fail "the profile under destroy does not hold slot 4"
run_destroy() {
  printf '%s\n' "$1" | PUBLIRA_DEV_ENV_HOME="${DEV_ENV_HOME}" PATH="${2:-${cli_bin_dir}}:${cli_bin_dir}:${PATH}" \
    bash "${REPO_ROOT}/scripts/dev-env.sh" destroy "$1" 2>&1
}

# The profile file is what reserves the slot, so a Valkey database that could
# not be flushed has to keep it: the next profile given that slot would read
# whatever is still in it.
if unflushed_output="$(run_destroy golf "${unflushable_bin_dir}")"; then
  fail "destroying a profile whose Valkey database could not be flushed reported success"
fi
[[ -e "${golf_path}" ]] || fail "the profile holding an unflushed Valkey database was removed"
[[ "$(dev_env_next_slot)" == "5" ]] || fail "an unflushed Valkey database's slot was handed out again"
[[ "${unflushed_output}" == *"Valkey database 4"* ]] ||
  fail "the Valkey database that was not flushed was not named: ${unflushed_output}"
pass "a profile whose Valkey database could not be flushed keeps its slot and its profile file"

destroy_output="$(run_destroy golf)" ||
  fail "destroying a profile whose bucket is already gone failed: ${destroy_output}"
[[ ! -e "${golf_path}" ]] || fail "the profile file of a destroyed profile was kept"
[[ "$(dev_env_next_slot)" == "4" ]] || fail "the slot of a destroyed profile was not freed"
pass "destroying a profile whose bucket is already gone completes, removes the profile, and frees its slot"

repeated_output="$(run_destroy golf)" ||
  fail "destroying a profile that is already gone failed: ${repeated_output}"
[[ "${repeated_output}" == *"nothing to destroy"* ]] ||
  fail "a repeated destroy did not report that there is nothing to destroy: ${repeated_output}"
pass "a repeated destroy reports that there is nothing to destroy"
