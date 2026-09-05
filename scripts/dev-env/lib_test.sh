#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

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
if dev_env_url_authority "postgres://" 5432 >/dev/null; then
  fail "a URL without a host was accepted"
fi
pass "URL authority extraction strips userinfo and path and applies the default port"

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
