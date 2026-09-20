#!/usr/bin/env bash
# storage-seed.sh — Uploads the development seed's images into PUBLIRA_S3_BUCKET.
#
# Two halves that have to agree: `db/seeds/dev/060_images.sql` describes every
# eye-catch, icon, and body page and names the object key each one is stored at,
# and this puts the bytes at those keys. The keys are read back out of the
# database rather than repeated here, so only the SQL decides them.
#
# A seeded key is `tenants/<tenant>/seed/<path>`, and `<path>` is where the file
# sits under `db/seeds/objects`. That is the whole mapping, which is why a new
# card is a file plus a row and nothing here.
#
# Idempotent: every key is written with the same bytes it already holds.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBJECT_DIR="${REPO_ROOT}/db/seeds/objects"

log() {
  printf '[storage-seed] %s\n' "$*"
}

err() {
  printf '[storage-seed] ERROR: %s\n' "$*" >&2
}

if ! command -v aws > /dev/null 2>&1; then
  err "aws CLI is required (Dev Container: devcontainer feature aws-cli)"
  exit 1
fi

if ! command -v psql > /dev/null 2>&1; then
  err "psql is required to read the object keys the seed rows name"
  exit 1
fi

bucket="${PUBLIRA_S3_BUCKET:?PUBLIRA_S3_BUCKET is required}"
db_url="${PUBLIRA_DB_URL:-postgres://postgres:password@db:5432/publira?sslmode=disable}"
endpoint="${PUBLIRA_S3_ENDPOINT:-}"
endpoint_args=()
if [[ -n "${endpoint}" ]]; then
  endpoint_args=(--endpoint-url "${endpoint}")
fi

# A command substitution rather than `mapfile < <(psql …)`: process substitution
# runs psql in a subshell whose exit status `set -e` never sees, so a query that
# failed part way through would upload a partial catalogue and still report
# success.
object_keys_text="$(
  psql "${db_url}" -v ON_ERROR_STOP=1 -t -A -c "
    SELECT object_key FROM series_image_variants WHERE object_key LIKE '%/seed/%'
    UNION
    SELECT object_key FROM label_image_variants WHERE object_key LIKE '%/seed/%'
    UNION
    SELECT object_key FROM creator_image_variants WHERE object_key LIKE '%/seed/%'
    UNION
    SELECT object_key FROM episode_image_variants WHERE object_key LIKE '%/seed/%'
    ORDER BY 1
  "
)"

if [[ -z "${object_keys_text}" ]]; then
  err "no seeded image rows found in ${db_url}; run 'task db:seed' first"
  exit 1
fi

mapfile -t object_keys <<< "${object_keys_text}"

# Both directions before anything is uploaded. A row naming a file that is not
# there would leave a reader with a broken image, and a file no row names is a
# card somebody rendered and forgot to seed — neither is worth discovering one
# upload at a time.
missing=()
declare -A wanted=()
for key in "${object_keys[@]}"; do
  relative="${key#*/seed/}"
  wanted["${relative}"]=1
  if [[ ! -f "${OBJECT_DIR}/${relative}" ]]; then
    missing+=("${relative}")
  fi
done

if ((${#missing[@]} > 0)); then
  err "seed rows name ${#missing[@]} object(s) with no file under db/seeds/objects:"
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

unreferenced=()
while read -r file; do
  relative="${file#"${OBJECT_DIR}/"}"
  if [[ -z "${wanted[${relative}]:-}" ]]; then
    unreferenced+=("${relative}")
  fi
done < <(find "${OBJECT_DIR}" -type f -name '*.jpg' | sort)

if ((${#unreferenced[@]} > 0)); then
  err "db/seeds/objects holds ${#unreferenced[@]} file(s) no seed row names:"
  printf '  %s\n' "${unreferenced[@]}" >&2
  exit 1
fi

# One sync rather than an upload per object: the mapping is a whole directory
# onto one key prefix, and a sequential `aws s3 cp` per card costs more than the
# rest of `task setup` put together. `--delete` is what clears the keys a
# redrawn card left behind.
prefix="${object_keys[0]%/seed/*}/seed"
for key in "${object_keys[@]}"; do
  if [[ "${key}" != "${prefix}/"* ]]; then
    err "seed object keys span more than one prefix: ${prefix}/ and ${key}"
    exit 1
  fi
done

aws s3 sync \
  --no-progress \
  --delete \
  "${endpoint_args[@]}" \
  "${OBJECT_DIR}" \
  "s3://${bucket}/${prefix}" > /dev/null

log "uploaded ${#object_keys[@]} seed images to s3://${bucket}/${prefix}"
