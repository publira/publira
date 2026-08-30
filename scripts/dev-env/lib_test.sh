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
dev_env_write_profile "alpha" 1
dev_env_write_profile "bravo" 2

alpha_path="$(dev_env_profile_path alpha)"
bravo_path="$(dev_env_profile_path bravo)"

for key in PUBLIRA_DB_URL PUBLIRA_CONTENT_STATS_DB_URL PUBLIRA_REDIS_URL PUBLIRA_S3_BUCKET PUBLIRA_COOKIE_SUFFIX PUBLIRA_WEB_HOST_PORT; do
  alpha_value="$(dev_env_profile_value "${alpha_path}" "${key}")"
  bravo_value="$(dev_env_profile_value "${bravo_path}" "${key}")"
  [[ "${alpha_value}" != "${bravo_value}" ]] || fail "${key} is shared by alpha and bravo"
done
pass "two profiles derive isolated database, Redis, bucket, Cookie, and port values"

[[ "$(dev_env_next_slot)" == "3" ]] || fail "next available slot is not 3"
pass "slot allocation avoids active profile slots"

if dev_env_identifier_is_valid "UPPER"; then
  fail "invalid identifier was accepted"
fi
pass "identifier validation rejects unsafe names"
