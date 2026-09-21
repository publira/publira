#!/usr/bin/env bash
# storage-init.sh — Idempotently creates PUBLIRA_S3_BUCKET via aws-cli and saves
# it as the platform's object store in PUBLIRA_DB_URL.
#
# The servers read the object store from platform_storage_config rather than
# from their environment, so a local database has to name the bucket this
# creates. The row signs with the ambient credential (AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY), which each process finds for itself.
#
# The script is designed to be called from `task storage:init` and
# is safe to run repeatedly (idempotent).
set -euo pipefail

if ! command -v aws > /dev/null 2>&1; then
  echo "aws CLI is required (Dev Container: devcontainer feature aws-cli)" >&2
  exit 1
fi

if ! command -v psql > /dev/null 2>&1; then
  echo "psql is required to save the bucket as the platform's object store" >&2
  exit 1
fi

bucket="${PUBLIRA_S3_BUCKET:?PUBLIRA_S3_BUCKET is required}"
db_url="${PUBLIRA_DB_URL:-postgres://postgres:password@db:5432/publira?sslmode=disable}"
region="${AWS_REGION:-us-east-1}"
force_path_style="${PUBLIRA_S3_FORCE_PATH_STYLE:-false}"
endpoint="${PUBLIRA_S3_ENDPOINT:-}"
endpoint_args=()
if [[ -n "${endpoint}" ]]; then
  endpoint_args=(--endpoint-url "${endpoint}")
fi

# save_platform_storage points platform_storage_config at the bucket. The
# revision moves only when a value changed, so a rerun leaves every running
# server's client as it is.
save_platform_storage() {
  psql "${db_url}" -v ON_ERROR_STOP=1 -q \
    -v bucket="${bucket}" -v region="${region}" -v endpoint="${endpoint}" \
    -v force_path_style="${force_path_style}" << 'SQL'
INSERT INTO platform_storage_config (singleton, bucket, region, endpoint, force_path_style)
VALUES (TRUE, :'bucket', :'region', NULLIF(:'endpoint', ''), :'force_path_style'::boolean)
ON CONFLICT (singleton) DO UPDATE
SET bucket = EXCLUDED.bucket,
    region = EXCLUDED.region,
    endpoint = EXCLUDED.endpoint,
    force_path_style = EXCLUDED.force_path_style,
    access_key_id = NULL,
    secret_access_key_encrypted = NULL,
    revision = platform_storage_config.revision + 1,
    updated_at = NOW()
WHERE (platform_storage_config.bucket, platform_storage_config.region,
        platform_storage_config.endpoint, platform_storage_config.force_path_style,
        platform_storage_config.access_key_id)
    IS DISTINCT FROM
    (EXCLUDED.bucket, EXCLUDED.region, EXCLUDED.endpoint, EXCLUDED.force_path_style, NULL::text);
SQL
  echo "storage configured for the platform (bucket=${bucket})"
}

# The Dev Container runs this from postCreate (`task setup`), where
# compose `depends_on` only orders startup and does not wait for the
# RustFS healthcheck. Retry for a bounded window, then let the last
# attempt fail loudly with the real error.
deadline=$((SECONDS + 30))
while ((SECONDS < deadline)); do
  if aws s3api head-bucket --bucket "${bucket}" "${endpoint_args[@]}" 2> /dev/null; then
    echo "storage initialized successfully (bucket=${bucket} already exists)"
    save_platform_storage
    exit 0
  fi
  if aws s3 mb "s3://${bucket}" "${endpoint_args[@]}" 2> /dev/null; then
    echo "storage initialized successfully (bucket=${bucket} created)"
    save_platform_storage
    exit 0
  fi
  sleep 1
done

aws s3 mb "s3://${bucket}" "${endpoint_args[@]}"
echo "storage initialized successfully (bucket=${bucket} created)"
save_platform_storage
