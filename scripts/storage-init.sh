#!/usr/bin/env bash
# storage-init.sh — Idempotently creates PUBLIRA_S3_BUCKET via aws-cli and saves
# it as the platform's object store with `publiractl storage set`, in the
# database PUBLIRA_PLATFORM_DB_URL names.
#
# The servers read the object store from platform_storage_config rather than
# from their environment, so a local database has to name the bucket this
# creates. The row signs with the ambient credential (AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY), which each process finds for itself.
#
# The script is designed to be called from `task storage:init` and
# is safe to run repeatedly (idempotent).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v aws > /dev/null 2>&1; then
  echo "aws CLI is required (Dev Container: devcontainer feature aws-cli)" >&2
  exit 1
fi

bucket="${PUBLIRA_S3_BUCKET:?PUBLIRA_S3_BUCKET is required}"
region="${AWS_REGION:-us-east-1}"
force_path_style="${PUBLIRA_S3_FORCE_PATH_STYLE:-false}"
endpoint="${PUBLIRA_S3_ENDPOINT:-}"
endpoint_args=()
set_args=(--bucket "${bucket}" --region "${region}")
if [[ -n "${endpoint}" ]]; then
  endpoint_args=(--endpoint-url "${endpoint}")
  set_args+=(--endpoint "${endpoint}")
fi
if [[ "${force_path_style}" == "true" ]]; then
  set_args+=(--force-path-style)
fi

# save_platform_storage points platform_storage_config at the bucket. A save
# of what is already saved changes nothing, so a rerun leaves every running
# server's client as it is. `go run` caches the binary it builds, so a rerun
# does not compile it again.
save_platform_storage() {
  go -C "${repo_root}/server" run ./cmd/publiractl storage set "${set_args[@]}"
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
