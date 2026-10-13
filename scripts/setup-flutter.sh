#!/usr/bin/env bash
# setup-flutter.sh — Install the Flutter SDK pinned by FLUTTER_VERSION.
#
# Clones the tag into FLUTTER_ROOT and bootstraps the Dart SDK and tooling so
# the first `flutter` call afterwards does no setup work of its own. A checkout
# of the same tag already at FLUTTER_ROOT, such as one a CI cache restored, is
# bootstrapped where it is instead of cloned again.
#
# Inputs (env):
#   FLUTTER_VERSION           Tag to check out (required)
#   FLUTTER_ROOT              Destination directory
#                             (default: ${RUNNER_TEMP:-${TMPDIR:-/tmp}}/flutter)
#   PUBLIRA_FLUTTER_PRECACHE  Platforms whose engine artifacts to download too,
#                             space-separated `flutter precache` flag names
#                             (e.g. `android`)
#   GITHUB_TOKEN              Authenticates the clone when set
#   GITHUB_PATH               Appended with the SDK's bin directory when set
set -euo pipefail

flutter_version="${FLUTTER_VERSION:?FLUTTER_VERSION is required}"
flutter_root="${FLUTTER_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/flutter}"
read -r -a precache_platforms <<< "${PUBLIRA_FLUTTER_PRECACHE:-}"

readonly attempts=3

# Runs the command after $1 until it succeeds, at most `attempts` times, backing
# off between attempts; $1 says what it does, for the message when none does.
retry() {
  local what="$1" attempt
  shift
  for ((attempt = 1; ; attempt++)); do
    "$@" && return 0
    if ((attempt == attempts)); then
      echo "Failed to ${what} after ${attempts} attempts." >&2
      exit 1
    fi
    sleep $((attempt * 5))
  done
}

# github.com answers an unauthenticated clone from a shared address with a
# credential prompt every so often (`fatal: could not read Username for
# 'https://github.com'`), which fails a CI job in seconds. A token makes the
# request attributable, and it is passed with `git -c` rather than
# `git clone -c`: the latter would persist the header in the cloned
# repository's own config, where every later `git` call flutter makes would
# read it.
git_options=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  # `base64 -w0` is GNU-only; macOS wraps unless the output is stripped here.
  credential="$(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 | tr -d '\n')"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::add-mask::${credential}"
  fi
  git_options=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${credential}")
fi

clone() {
  git "${git_options[@]}" clone \
    --depth 1 \
    --branch "${flutter_version}" \
    https://github.com/flutter/flutter.git \
    "${flutter_root}" && return 0
  # A failed clone can leave a partial working tree behind, which would make the
  # next attempt fail on a non-empty destination instead of on the network. The
  # destination did not exist before this run, so nothing else is under it.
  rm -rf "${flutter_root}"
  return 1
}

# The first `flutter` call downloads the Dart SDK and builds the tool. A download
# that breaks off can leave the SDK half extracted, so it goes before the next
# attempt, and with it the stamp that would make Flutter skip the download.
bootstrap() {
  "${flutter_root}/bin/flutter" --version && return 0
  rm -rf "${flutter_root}/bin/cache/dart-sdk" "${flutter_root}/bin/cache/engine-dart-sdk.stamp"
  return 1
}

if [[ -e "${flutter_root}" ]]; then
  # Anything but a checkout of this tag is left alone: `git clone` would refuse
  # it anyway, and stopping here keeps the clone's retries from deleting a
  # directory this run did not create.
  head="$(git -C "${flutter_root}" rev-parse --verify --quiet HEAD 2> /dev/null || true)"
  tag="$(git -C "${flutter_root}" rev-parse --verify --quiet "refs/tags/${flutter_version}^{commit}" 2> /dev/null || true)"
  if [[ -z "${head}" || "${head}" != "${tag}" ]]; then
    echo "${flutter_root} already exists and is not a checkout of ${flutter_version}. Remove it or point FLUTTER_ROOT elsewhere." >&2
    exit 1
  fi
  echo "Using the Flutter SDK (${flutter_version}) already at ${flutter_root}."
else
  retry "clone the Flutter SDK (${flutter_version})" clone
fi

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${flutter_root}/bin" >> "${GITHUB_PATH}"
else
  echo "Add ${flutter_root}/bin to PATH to use this SDK."
fi

retry "bootstrap the Flutter SDK (${flutter_version})" bootstrap
"${flutter_root}/bin/dart" --version
if ((${#precache_platforms[@]} > 0)); then
  retry "download the ${precache_platforms[*]} artifacts" \
    "${flutter_root}/bin/flutter" precache "${precache_platforms[@]/#/--}"
fi
