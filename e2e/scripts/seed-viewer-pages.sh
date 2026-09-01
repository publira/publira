#!/usr/bin/env bash
# Give the free seed episode a body the canvas viewer can draw.
#
# Two halves that have to agree: `db/seeds/scenarios/050_viewer_pages.sql`
# describes eight pages, and the fixture JPEGs have to sit at the object keys
# those rows name. The keys are read back out of the database rather than
# repeated here, so only the SQL decides them.
#
# Idempotent: the scenario upserts by primary key and `aws s3 cp` overwrites.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FIXTURE_DIR="${E2E_DIR}/fixtures/viewer-pages"
SCENARIO_SQL="${REPO_ROOT}/db/seeds/scenarios/050_viewer_pages.sql"

if ! command -v aws >/dev/null 2>&1; then
  e2e_err "aws CLI is required to upload viewer page fixtures"
  exit 1
fi

e2e_log "applying ${SCENARIO_SQL}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${SCENARIO_SQL}"

# display_order is the reading order, and page-NN.jpg is numbered the same way.
mapfile -t object_keys < <(
  psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -t -A -c "
    SELECT eiv.object_key
    FROM episode_images ei
      JOIN episode_image_variants eiv ON eiv.episode_image_id = ei.id
      JOIN episodes e ON e.id = ei.episode_id
    WHERE e.public_id = 'SeedEPSDAAA1'
    ORDER BY ei.display_order ASC
  "
)

if [[ "${#object_keys[@]}" -eq 0 ]]; then
  e2e_err "050_viewer_pages left no episode images for SeedEPSDAAA1"
  exit 1
fi

for index in "${!object_keys[@]}"; do
  fixture="$(printf '%s/page-%02d.jpg' "${FIXTURE_DIR}" "$((index + 1))")"
  if [[ ! -f "${fixture}" ]]; then
    e2e_err "missing viewer page fixture ${fixture}"
    exit 1
  fi
  aws s3 cp \
    --quiet \
    --content-type image/jpeg \
    --endpoint-url "${PUBLIRA_S3_ENDPOINT}" \
    "${fixture}" \
    "s3://${PUBLIRA_S3_BUCKET}/${object_keys[index]}"
done

e2e_log "uploaded ${#object_keys[@]} viewer page fixtures to s3://${PUBLIRA_S3_BUCKET}"
