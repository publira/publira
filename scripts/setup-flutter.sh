#!/usr/bin/env bash
# setup-flutter.sh — Install the Flutter SDK pinned by FLUTTER_VERSION.
#
# Clones the tag into FLUTTER_ROOT and bootstraps the Dart SDK and tooling so
# the first `flutter` call afterwards does no setup work of its own.
#
# Inputs (env):
#   FLUTTER_VERSION  Tag to check out (required)
#   FLUTTER_ROOT     Destination directory
#                    (default: ${RUNNER_TEMP:-${TMPDIR:-/tmp}}/flutter)
#   GITHUB_TOKEN     Authenticates the clone when set
#   GITHUB_PATH      Appended with the SDK's bin directory when set
set -euo pipefail

flutter_version="${FLUTTER_VERSION:?FLUTTER_VERSION is required}"
flutter_root="${FLUTTER_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/flutter}"

# github.com answers an unauthenticated clone from a shared address with a
# credential prompt every so often, which fails a CI job in seconds. A token
# makes the request attributable, and it is passed with `git -c` rather than
# `git clone -c`: the latter would persist the header in the cloned
# repository's own config, where every later `git` call flutter makes would
# read it.
git_options=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  credential="$(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 -w0)"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::add-mask::${credential}"
  fi
  git_options=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${credential}")
fi

attempts=3
for ((attempt = 1; attempt <= attempts; attempt++)); do
  if git "${git_options[@]}" clone \
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

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${flutter_root}/bin" >> "${GITHUB_PATH}"
else
  echo "Add ${flutter_root}/bin to PATH to use this SDK."
fi

"${flutter_root}/bin/flutter" --version
"${flutter_root}/bin/dart" --version
