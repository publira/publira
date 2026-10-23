#!/usr/bin/env bash
# check-proto-compat.sh — Fail when proto/ breaks the API of the newest release,
# as `buf breaking` judges it with the rules in buf.yaml.
#
# The web apps and `publira server` of a release work with those of the release
# before it, in either direction, so what a branch changes in proto/ has to keep
# accepting and answering what the newest release sends and reads. The tags are
# read from the repository the releases are published from rather than from the
# local clone, so the check runs the same from a shallow CI checkout, from a
# fork, and from a clone that never fetched them. CI runs this script in `Check`.
set -euo pipefail

repository="https://github.com/publira/publira.git"

# buf.yaml sits at the repository root, so the check reads the same from any
# directory.
repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

# A tag with a suffix is a prerelease, which no release has to keep working with.
previous="$(git ls-remote --tags --refs "${repository}" 'v*' |
  sed -n 's#^.*refs/tags/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$#\1#p' |
  sort -V | tail -n 1)"
if [[ -z "${previous}" ]]; then
  echo "${repository} has no release tag, so there is no API to keep." >&2
  exit 1
fi

format=()
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  format=(--error-format=github-actions)
fi

buf breaking --against "${repository}#tag=${previous}" "${format[@]}"

echo "proto/: compatible with ${previous}."
