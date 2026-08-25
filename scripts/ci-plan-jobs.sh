#!/usr/bin/env bash
# Plan which CI jobs and Docker matrix entries to run.
# Invoked from .github/workflows/ci.yml (Detect changes / Plan jobs).
#
# Inputs (env):
#   EVENT_NAME, DOCKER_MODE_INPUT
#   FILTER_CHECK, FILTER_LINT_GO, FILTER_TEST_GO, FILTER_TEST_TS, FILTER_TEST_DB_MIGRATIONS, FILTER_TEST_MOBILE, FILTER_TEST_MOBILE_E2E, FILTER_TEST_E2E,
#   FILTER_TEST_BOOTSTRAP, FILTER_TEST_ROUTING, FILTER_BUILD
#   FILTER_DOCKER_WEB, FILTER_DOCKER_API, FILTER_DOCKER_IMAGE, FILTER_DOCKER_BATCH, FILTER_DOCKER_NODE, FILTER_DOCKER_CORE
#   GITHUB_OUTPUT (required)
set -euo pipefail

if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "GITHUB_OUTPUT is required" >&2
  exit 1
fi

event="${EVENT_NAME:-}"
docker_mode_input="${DOCKER_MODE_INPUT:-verify}"
if [[ -z "${docker_mode_input}" ]]; then
  docker_mode_input="verify"
fi

flag() {
  local name="$1"
  [[ "${!name:-}" == "true" ]]
}

# Fixed matrix rows (JSON objects, no spaces needed for GITHUB_OUTPUT single-line).
rep_web='{"role":"web","target":"web-host","port":"3000","task":"docker:build:web","arg":"APP_NAME=web-host","extra":"PORT=3000"}'
rep_api='{"role":"api","target":"api-server","port":"8000","task":"docker:build:api","arg":"CMD_NAME=api-server","extra":"PORT=8000"}'
rep_image='{"role":"image","target":"image-server","port":"8200","task":"docker:build:image","arg":"CMD_NAME=image-server","extra":"PORT=8200"}'
rep_batch='{"role":"batch","target":"publish-episodes","port":"","task":"docker:build:batch","arg":"CMD_NAME=publish-episodes","extra":""}'
rep_node='{"role":"node","target":"email-renderer","port":"8080","task":"docker:build:node","arg":"APP_NAME=email-renderer","extra":"PORT=8080"}'

full_web_host='{"role":"web","target":"web-host","port":"3000","task":"docker:build:web","arg":"APP_NAME=web-host","extra":"PORT=3000"}'
full_web_admin='{"role":"web","target":"web-admin","port":"4000","task":"docker:build:web","arg":"APP_NAME=web-admin","extra":"PORT=4000"}'
full_web_platform='{"role":"web","target":"web-platform","port":"4100","task":"docker:build:web","arg":"APP_NAME=web-platform","extra":"PORT=4100"}'
full_api='{"role":"api","target":"api-server","port":"8000","task":"docker:build:api","arg":"CMD_NAME=api-server","extra":"PORT=8000"}'
full_admin_api='{"role":"api","target":"admin-api-server","port":"8001","task":"docker:build:api","arg":"CMD_NAME=admin-api-server","extra":"PORT=8001"}'
full_platform_api='{"role":"api","target":"platform-api-server","port":"8002","task":"docker:build:api","arg":"CMD_NAME=platform-api-server","extra":"PORT=8002"}'
full_outbox_worker='{"role":"api","target":"outbox-worker","port":"8003","task":"docker:build:api","arg":"CMD_NAME=outbox-worker","extra":"PORT=8003"}'
full_batch='{"role":"batch","target":"publish-episodes","port":"","task":"docker:build:batch","arg":"CMD_NAME=publish-episodes","extra":""}'
full_image='{"role":"image","target":"image-server","port":"8200","task":"docker:build:image","arg":"CMD_NAME=image-server","extra":"PORT=8200"}'
full_admin_image='{"role":"image","target":"admin-image-server","port":"8201","task":"docker:build:image","arg":"CMD_NAME=admin-image-server","extra":"PORT=8201"}'
full_node_email_renderer='{"role":"node","target":"email-renderer","port":"8080","task":"docker:build:node","arg":"APP_NAME=email-renderer","extra":"PORT=8080"}'
skip_row='{"role":"none","target":"skip","port":"","task":"skip","arg":"","extra":""}'

join_json_array() {
  local first=1
  local item
  printf '['
  for item in "$@"; do
    if ((first)); then
      first=0
    else
      printf ','
    fi
    printf '%s' "${item}"
  done
  printf ']'
}

check=false
lint_go=false
test_go=false
test_ts=false
test_db_migrations=false
test_mobile=false
test_mobile_e2e=false
test_e2e=false
test_bootstrap=false
test_routing=false
build=false
matrix_items=()

case "${event}" in
  schedule)
    # Nightly: Docker full matrix, plus the bootstrap check. Its path filter is
    # deliberately narrow (config paths), so a nightly run is what catches dev
    # environment drift coming from ordinary server/ or apps/ changes.
    test_bootstrap=true
    matrix_items=(
      "${full_web_host}"
      "${full_web_admin}"
      "${full_web_platform}"
      "${full_api}"
      "${full_admin_api}"
      "${full_platform_api}"
      "${full_outbox_worker}"
      "${full_batch}"
      "${full_image}"
      "${full_admin_image}"
      "${full_node_email_renderer}"
    )
    ;;
  workflow_dispatch)
    # Manual: always host CI + selected Docker set.
    check=true
    lint_go=true
    test_go=true
    test_ts=true
    test_db_migrations=true
    test_mobile=true
    test_mobile_e2e=true
    test_e2e=true
    test_bootstrap=true
    test_routing=true
    build=true
    if [[ "${docker_mode_input}" == "full" ]]; then
      matrix_items=(
        "${full_web_host}"
        "${full_web_admin}"
        "${full_web_platform}"
        "${full_api}"
        "${full_admin_api}"
        "${full_platform_api}"
        "${full_outbox_worker}"
        "${full_batch}"
        "${full_image}"
        "${full_admin_image}"
        "${full_node_email_renderer}"
      )
    else
      matrix_items=("${rep_web}" "${rep_api}" "${rep_batch}" "${rep_node}" "${rep_image}")
    fi
    ;;
  *)
    # pull_request / push: path-filter driven.
    if flag FILTER_CHECK; then check=true; fi
    if flag FILTER_LINT_GO; then lint_go=true; fi
    if flag FILTER_TEST_GO; then test_go=true; fi
    if flag FILTER_TEST_TS; then test_ts=true; fi
    if flag FILTER_TEST_DB_MIGRATIONS; then test_db_migrations=true; fi
    if flag FILTER_TEST_MOBILE; then test_mobile=true; fi
    if flag FILTER_TEST_MOBILE_E2E; then test_mobile_e2e=true; fi
    if flag FILTER_TEST_E2E; then test_e2e=true; fi
    if flag FILTER_TEST_BOOTSTRAP; then test_bootstrap=true; fi
    if flag FILTER_TEST_ROUTING; then test_routing=true; fi
    if flag FILTER_BUILD; then build=true; fi
    if flag FILTER_DOCKER_CORE; then
      matrix_items=(
        "${full_web_host}"
        "${full_web_admin}"
        "${full_web_platform}"
        "${full_api}"
        "${full_admin_api}"
        "${full_platform_api}"
        "${full_outbox_worker}"
        "${full_batch}"
        "${full_image}"
        "${full_admin_image}"
        "${full_node_email_renderer}"
      )
    else
      if flag FILTER_DOCKER_WEB; then matrix_items+=("${rep_web}"); fi
      if flag FILTER_DOCKER_API; then matrix_items+=("${rep_api}"); fi
      if flag FILTER_DOCKER_IMAGE; then matrix_items+=("${rep_image}"); fi
      if flag FILTER_DOCKER_BATCH; then matrix_items+=("${rep_batch}"); fi
      if flag FILTER_DOCKER_NODE; then matrix_items+=("${rep_node}"); fi
    fi
    ;;
esac

if ((${#matrix_items[@]} > 0)); then
  docker_any=true
  docker_matrix="$(join_json_array "${matrix_items[@]}")"
else
  docker_any=false
  # Non-empty placeholder so fromJson never sees an empty array when the job is skipped.
  docker_matrix="$(join_json_array "${skip_row}")"
fi

{
  echo "check=${check}"
  echo "lint_go=${lint_go}"
  echo "test_go=${test_go}"
  echo "test_ts=${test_ts}"
  echo "test_db_migrations=${test_db_migrations}"
  echo "test_mobile=${test_mobile}"
  echo "test_mobile_e2e=${test_mobile_e2e}"
  echo "test_e2e=${test_e2e}"
  echo "test_bootstrap=${test_bootstrap}"
  echo "test_routing=${test_routing}"
  echo "build=${build}"
  echo "docker_any=${docker_any}"
  echo "docker_matrix=${docker_matrix}"
} >>"${GITHUB_OUTPUT}"

echo "event=${event}"
echo "check=${check} lint_go=${lint_go} test_go=${test_go} test_ts=${test_ts} test_db_migrations=${test_db_migrations} test_mobile=${test_mobile} test_mobile_e2e=${test_mobile_e2e} test_e2e=${test_e2e} test_bootstrap=${test_bootstrap} test_routing=${test_routing} build=${build} docker_any=${docker_any}"
if ((${#matrix_items[@]} > 0)); then
  for item in "${matrix_items[@]}"; do
    # shellcheck disable=SC2001
    role="$(sed -n 's/.*"role":"\([^"]*\)".*/\1/p' <<<"${item}")"
    target="$(sed -n 's/.*"target":"\([^"]*\)".*/\1/p' <<<"${item}")"
    echo "  docker: ${role}/${target}"
  done
fi
