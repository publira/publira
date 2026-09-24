#!/usr/bin/env bash
# Install the Android Emulator and the system image `Test / Mobile E2E` boots,
# retrying a download that breaks off. The emulator runner installs both in one
# attempt, and leaves a package already at its newest revision alone.
#
# Writes the image's api-level, target, and arch to GITHUB_OUTPUT for the
# emulator runner to boot.
set -euo pipefail

# shellcheck source=./android-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/android-env.sh"

readonly ATTEMPTS=5
readonly RETRY_DELAY_SECONDS=5

sdkmanager="${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"

# The emulator runner accepts every license before it installs anything too.
{ yes || true; } | "${sdkmanager}" --licenses > /dev/null

attempt=1
# The stable channel, the one the emulator runner installs from.
until "${sdkmanager}" --install emulator "${ANDROID_SYSTEM_IMAGE}" --channel=0 > /dev/null; do
  ((attempt < ATTEMPTS)) || android_die "sdkmanager failed ${ATTEMPTS} times"
  android_log "sdkmanager failed (attempt ${attempt}/${ATTEMPTS}); retrying in ${RETRY_DELAY_SECONDS}s"
  sleep "${RETRY_DELAY_SECONDS}"
  attempt=$((attempt + 1))
done

IFS=';' read -r _ platform target arch <<< "${ANDROID_SYSTEM_IMAGE}"
{
  echo "api-level=${platform#android-}"
  echo "target=${target}"
  echo "arch=${arch}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
