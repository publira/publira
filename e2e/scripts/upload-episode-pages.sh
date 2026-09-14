#!/usr/bin/env bash
# Upload a body-image fixture for every page one seeded episode holds.
#
# Two halves that have to agree: a scenario's SQL describes the pages, and the
# fixture JPEGs have to sit at the object keys those rows name. The keys are
# read back out of the database rather than repeated here, so only the SQL
# decides them.
#
# Applying the scenario is the caller's job: a suite that seeds a tenant of its
# own applies its file itself and calls this afterwards. The development seed's
# own episodes are uploaded by `task storage:seed` instead.
#
# Idempotent: `aws s3 cp` overwrites.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FIXTURE_DIR="${REPO_ROOT}/db/seeds/objects/episode-page"

episode_public_id="${1-}"
if [[ -z "${episode_public_id}" ]]; then
  e2e_err "usage: upload-episode-pages.sh <episode_public_id>"
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  e2e_err "aws CLI is required to upload viewer page fixtures"
  exit 1
fi

# Each row is one variant, paired with the reading order of the image it belongs
# to. page-NN.jpg is numbered that same way, so the fixture follows
# `display_order` rather than the position of the row: an image with more than
# one variant would otherwise hand later variants the wrong page.
#
# A command substitution rather than `mapfile < <(psql …)`: process substitution
# runs psql in a subshell whose exit status `set -e` never sees, so a query that
# failed after writing some rows would seed a partial page set and still report
# success.
rows_text="$(
  psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -t -A -F ' ' -c "
    SELECT ei.display_order, eiv.object_key
    FROM episode_images ei
      JOIN episode_image_variants eiv ON eiv.episode_image_id = ei.id
      JOIN episodes e ON e.id = ei.episode_id
    WHERE e.public_id = '${episode_public_id}'
    ORDER BY ei.display_order ASC
  "
)"

fixtures=("${FIXTURE_DIR}"/page-*.jpg)

# An episode read half way through is worse than one that never loaded, so
# every page has to have a fixture before anything is uploaded.
if [[ -z "${rows_text}" ]]; then
  e2e_err "no episode images for ${episode_public_id}"
  exit 1
fi

mapfile -t rows <<<"${rows_text}"

for row in "${rows[@]}"; do
  display_order="${row%% *}"
  object_key="${row#* }"
  fixture="$(printf '%s/page-%02d.jpg' "${FIXTURE_DIR}" "${display_order}")"
  if [[ ! -f "${fixture}" ]]; then
    e2e_err "${episode_public_id} page ${display_order} has no fixture at ${fixture}; only ${#fixtures[@]} exist"
    exit 1
  fi
  aws s3 cp \
    --quiet \
    --content-type image/jpeg \
    --endpoint-url "${PUBLIRA_S3_ENDPOINT}" \
    "${fixture}" \
    "s3://${PUBLIRA_S3_BUCKET}/${object_key}"
done

e2e_log "uploaded ${#rows[@]} viewer page fixtures for ${episode_public_id} to s3://${PUBLIRA_S3_BUCKET}"
