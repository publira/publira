#!/usr/bin/env bash
# Install the Android SDK packages the CI jobs build the app with, and with
# --emulator the emulator and the system image `Test / Mobile E2E` boots,
# retrying a download that breaks off. Gradle installs a missing NDK or CMake
# itself in the middle of the build, once and without retrying, so they are put
# in place before it starts.
#
#   android-packages.sh plan [--emulator]     names the packages, for the caches
#                                             keyed on them
#   android-packages.sh install [--emulator]  installs them
#
# Both write to GITHUB_OUTPUT:
#   plan     sdk-root; ndk and cmake, the versions, and ndk-installed and
#            cmake-installed, whether the runner image already has them; with
#            --emulator, system-image-dir, where the image lives under the
#            SDK, system-image-key, a cache key part naming it, and its
#            api-level, target, and arch for the emulator runner to boot
#   install  with --emulator, emulator-revisions: the revisions of the
#            emulator and the system image now installed
set -euo pipefail

# shellcheck source=./android-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/android-env.sh"

readonly ATTEMPTS=5
readonly FIRST_RETRY_DELAY_SECONDS=10

# The CMake the Android Gradle Plugin installs for the empty CMakeLists.txt the
# Flutter Gradle plugin adds so that AGP installs the NDK at all. It is AGP's
# default, since nothing in the build names a version.
readonly CMAKE_VERSION='3.22.1'

sdkmanager="${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"

# The NDK `ndkVersion = flutter.ndkVersion` in android/app/build.gradle.kts
# selects. The Flutter Gradle plugin declares it in its source, and nothing the
# `flutter` command prints carries it.
flutter_ndk_version() {
  local flutter root extension version
  flutter="$(command -v flutter)" || android_die "flutter is not on PATH"
  root="$(cd "$(dirname "${flutter}")/.." && pwd -P)"
  extension="${root}/packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt"
  version="$(sed -n 's/^ *val ndkVersion: String = "\(.*\)"$/\1/p' "${extension}" 2> /dev/null)"
  [[ -n "${version}" ]] ||
    android_die "${extension} declares no ndkVersion; find where Flutter moved it and read it from there"
  printf '%s\n' "${version}"
}

installed() {
  [[ -f "${ANDROID_HOME}/${1//;//}/source.properties" ]]
}

revision() {
  sed -n 's/^Pkg\.Revision *= *//p' "${ANDROID_HOME}/${1//;//}/source.properties"
}

plan() {
  local emulator="$1" ndk
  ndk="$(flutter_ndk_version)"
  {
    echo "sdk-root=${ANDROID_HOME}"
    echo "ndk=${ndk}"
    echo "ndk-installed=$(installed "ndk;${ndk}" && echo true || echo false)"
    echo "cmake=${CMAKE_VERSION}"
    echo "cmake-installed=$(installed "cmake;${CMAKE_VERSION}" && echo true || echo false)"
  } >> "${GITHUB_OUTPUT:-/dev/stdout}"
  [[ "${emulator}" == true ]] || return 0
  local platform target arch key
  IFS=';' read -r _ platform target arch <<< "${ANDROID_SYSTEM_IMAGE}"
  key="${ANDROID_SYSTEM_IMAGE#system-images;}"
  {
    echo "system-image-dir=${ANDROID_SYSTEM_IMAGE//;//}"
    echo "system-image-key=${key//;/-}"
    echo "api-level=${platform#android-}"
    echo "target=${target}"
    echo "arch=${arch}"
  } >> "${GITHUB_OUTPUT:-/dev/stdout}"
}

install() {
  local emulator="$1"
  local packages=("ndk;$(flutter_ndk_version)" "cmake;${CMAKE_VERSION}")
  if [[ "${emulator}" == true ]]; then
    packages+=(emulator "${ANDROID_SYSTEM_IMAGE}")
  fi

  # The emulator runner accepts every license before it installs anything too.
  { yes || true; } | "${sdkmanager}" --licenses > /dev/null

  # The stable channel, the one the emulator runner installs from. A package
  # already at its newest revision is left alone, so an emulator or image a
  # cache restored is downloaded again only once a newer one is out.
  local attempt delay="${FIRST_RETRY_DELAY_SECONDS}"
  for ((attempt = 1; ; attempt++)); do
    "${sdkmanager}" --install "${packages[@]}" --channel=0 > /dev/null && break
    ((attempt < ATTEMPTS)) || android_die "sdkmanager failed ${ATTEMPTS} times"
    android_log "sdkmanager failed (attempt ${attempt}/${ATTEMPTS}); retrying in ${delay}s"
    sleep "${delay}"
    delay=$((delay * 2))
  done

  [[ "${emulator}" == true ]] || return 0
  echo "emulator-revisions=$(revision emulator)-$(revision "${ANDROID_SYSTEM_IMAGE}")" >> "${GITHUB_OUTPUT:-/dev/stdout}"
}

emulator=false
case "${2:-}" in
  '') ;;
  --emulator) emulator=true ;;
  *) android_die "usage: android-packages.sh plan|install [--emulator]" ;;
esac
case "${1:-}" in
  plan) plan "${emulator}" ;;
  install) install "${emulator}" ;;
  *) android_die "usage: android-packages.sh plan|install [--emulator]" ;;
esac
