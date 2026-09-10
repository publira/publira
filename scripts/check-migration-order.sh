#!/usr/bin/env bash
# check-migration-order.sh — Fail when a migration this branch adds is numbered
# below the highest version already on the base branch.
#
# `schema_migrations` holds a single version and `migrate up` applies only what
# sorts above it, so a migration that ends up below one which merged first is
# skipped forever on any database that already applied the newer version — and
# `migrate up` still exits 0. Applying the migrations to an empty database
# cannot see this, because there every migration runs in order whatever its
# number, so this is the check to run before pushing. CI runs the same script in
# `Test / DB Migrations`.
#
# Inputs (env):
#   BASE_REF  Ref the branch is compared against (default: origin/main)
set -euo pipefail

base_ref="${BASE_REF:-origin/main}"

# Paths below are repo-relative, so the check reads the same from any directory.
repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

if ! git rev-parse --verify --quiet "${base_ref}^{commit}" >/dev/null; then
  echo "${base_ref} is not in this repository. Run 'git fetch origin main' first, or set BASE_REF." >&2
  exit 1
fi

# `<version>_<name>.(up|down).sql` — anything else under the directory is not a
# migration and has no version to compare.
version_of='s#^db/migrations/\([0-9][0-9]*\)_.*#\1#p'

base_max="$(git ls-tree -r --name-only "${base_ref}" -- db/migrations/ | sed -n "${version_of}" | sort -n | tail -n 1)"

behind=""
for path in $(git diff --name-only --diff-filter=A "${base_ref}...HEAD" -- db/migrations/); do
  version="$(printf '%s\n' "${path}" | sed -n "${version_of}")"
  if [[ -z "${version}" || -z "${base_max}" ]]; then
    continue
  fi
  # 10# reads the zero-padded initial-schema numbering as decimal, not octal.
  if ((10#${version} < 10#${base_max})); then
    message="${path} is version ${version}, below ${base_max}, the highest migration version on ${base_ref}, so it would never be applied. Renumber it: create a fresh pair with 'task db:create NAME=<name>' and move the contents across."
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      echo "::error file=${path}::${message}"
    else
      echo "${message}" >&2
    fi
    behind=1
  fi
done

if [[ -n "${behind}" ]]; then
  exit 1
fi

echo "db/migrations/: every migration this branch adds sorts above ${base_max:-none} on ${base_ref}."
