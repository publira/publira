#!/usr/bin/env bash
# ci-setup-flutter.sh — Install the Flutter SDK for a GitHub Actions job.
#
# Clones the tag named by FLUTTER_VERSION into RUNNER_TEMP and appends the SDK's
# bin directory to GITHUB_PATH, then bootstraps the Dart SDK and tooling so the
# following steps do not pay for it.
#
# Inputs (env):
#   FLUTTER_VERSION, GITHUB_TOKEN (required)
#   RUNNER_TEMP, GITHUB_PATH (provided by the runner)
set -euo pipefail

flutter_version="${FLUTTER_VERSION:?FLUTTER_VERSION is required}"
token="${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
runner_temp="${RUNNER_TEMP:?RUNNER_TEMP is required}"
github_path="${GITHUB_PATH:?GITHUB_PATH is required}"

flutter_root="${runner_temp}/flutter"

# github.com answers an unauthenticated clone from a shared runner address with a
# credential prompt every so often, which fails the job in seconds. Carry the job
# token so the request is attributed to this repository, and pass it with
# `git -c` rather than `git clone -c`: the latter would persist the header in the
# cloned repository's own config, where every later `git` call flutter makes
# would read it.
credential="$(printf 'x-access-token:%s' "${token}" | base64 -w0)"
echo "::add-mask::${credential}"

attempts=3
for ((attempt = 1; attempt <= attempts; attempt++)); do
  if git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${credential}" clone \
    --depth 1 \
    --branch "${flutter_version}" \
    https://github.com/flutter/flutter.git \
    "${flutter_root}"; then
    break
  fi
  if ((attempt == attempts)); then
    echo "Failed to clone the Flutter SDK (${flutter_version}) after ${attempts} attempts." >&2
    exit 1
  fi
  # A failed clone can leave a partial working tree behind, which would make the
  # next attempt fail on a non-empty destination instead of on the network.
  rm -rf "${flutter_root}"
  sleep $((attempt * 5))
done

echo "${flutter_root}/bin" >> "${github_path}"

# Bootstrap Dart SDK / tooling for subsequent steps
"${flutter_root}/bin/flutter" --version
"${flutter_root}/bin/dart" --version
