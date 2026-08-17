#!/usr/bin/env bash
# storage-init.sh — Idempotently initializes the storage backend.
#
# PUBLIRA_STORAGE_BACKEND=local → creates PUBLIRA_LOCAL_STORAGE_DIR.
# PUBLIRA_STORAGE_BACKEND=s3    → creates PUBLIRA_S3_BUCKET via aws-cli.
#
# The script is designed to be called from `task server:storage-init` and
# is safe to run repeatedly (idempotent).
set -euo pipefail

backend="${PUBLIRA_STORAGE_BACKEND:-local}"

case "${backend}" in
  local)
    dir="${PUBLIRA_LOCAL_STORAGE_DIR:?PUBLIRA_LOCAL_STORAGE_DIR is required when PUBLIRA_STORAGE_BACKEND=local}"
    mkdir -p "${dir}"
    echo "storage initialized successfully (backend=local, dir=${dir})"
    ;;
  s3)
    if ! command -v aws >/dev/null 2>&1; then
      echo "aws CLI is required when PUBLIRA_STORAGE_BACKEND=s3 (Dev Container: devcontainer feature aws-cli)" >&2
      exit 1
    fi

    bucket="${PUBLIRA_S3_BUCKET:?PUBLIRA_S3_BUCKET is required when PUBLIRA_STORAGE_BACKEND=s3}"
    endpoint="${PUBLIRA_S3_ENDPOINT:-}"
    endpoint_args=()
    if [[ -n "${endpoint}" ]]; then
      endpoint_args=(--endpoint-url "${endpoint}")
    fi

    # The Dev Container runs this from postCreate (`task setup`), where
    # compose `depends_on` only orders startup and does not wait for the
    # RustFS healthcheck. Retry for a bounded window, then let the last
    # attempt fail loudly with the real error.
    deadline=$((SECONDS + 30))
    while ((SECONDS < deadline)); do
      if aws s3api head-bucket --bucket "${bucket}" "${endpoint_args[@]}" 2>/dev/null; then
        echo "storage initialized successfully (backend=s3, bucket=${bucket} already exists)"
        exit 0
      fi
      if aws s3 mb "s3://${bucket}" "${endpoint_args[@]}" 2>/dev/null; then
        echo "storage initialized successfully (backend=s3, bucket=${bucket} created)"
        exit 0
      fi
      sleep 1
    done

    aws s3 mb "s3://${bucket}" "${endpoint_args[@]}"
    echo "storage initialized successfully (backend=s3, bucket=${bucket} created)"
    ;;
  *)
    echo "unsupported PUBLIRA_STORAGE_BACKEND: ${backend}" >&2
    exit 1
    ;;
esac
