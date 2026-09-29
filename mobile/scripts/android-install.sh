#!/usr/bin/env bash
# Install a JDK, the Android SDK, and an emulator into the Dev Container, for
# the integration tests and screenshots that need an Android device. Running it
# again installs only what is missing.
set -euo pipefail

# shellcheck source=./android-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/android-env.sh"

# The manifest sdkmanager installs every other package from, and checks each
# download against.
readonly REPOSITORY_URL='https://dl.google.com/android/repository'
# The Temurin build ci.yml sets up. Renovate updates it together with the
# java-version there, because both carry the same depName.
# renovate: datasource=java-version depName=java-jdk
readonly JDK_VERSION='25.0.4+101.0.LTS'
readonly JDK_HOME="${HOME}/Android/temurin-${JDK_VERSION}"

sdkmanager="${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"
avdmanager="${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager"

require_host() {
  [[ "$(uname -m)" == 'x86_64' ]] ||
    android_die "the emulator image this installs is x86_64, and this host is $(uname -m)"
  # Checked before anything is downloaded: without KVM the emulator cannot boot,
  # and the gigabytes below would be of no use.
  [[ -e /dev/kvm ]] ||
    android_die "/dev/kvm is missing: this host does not pass KVM into the container, so no emulator can run here"
}

# Prints the download link and SHA-256 of the Linux x64 archive of JDK_VERSION,
# which Adoptium lists by its semver rather than its release name.
temurin_archive() {
  local feature="${JDK_VERSION%%.*}"
  curl -fsSL "https://api.adoptium.net/v3/assets/feature_releases/${feature}/ga?architecture=x64&image_type=jdk&os=linux&vendor=eclipse&jvm_impl=hotspot&heap_size=normal&project=jdk&page_size=50" |
    python3 -c '
import json, sys
for release in json.load(sys.stdin):
    if release["version_data"]["semver"] == sys.argv[1]:
        package = release["binaries"][0]["package"]
        print(package["link"], package["checksum"])
        break
' "${JDK_VERSION}"
}

install_jdk() {
  if [[ ! -x "${JDK_HOME}/bin/java" ]]; then
    local archive link sha256 work
    archive="$(temurin_archive)"
    [[ -n "${archive}" ]] || android_die "Adoptium lists no Linux x64 build of Temurin ${JDK_VERSION}"
    read -r link sha256 <<< "${archive}"
    work="$(mktemp -d)"
    android_log "downloading Temurin ${JDK_VERSION}"
    curl -fsSL -o "${work}/jdk.tar.gz" "${link}"
    printf '%s  %s\n' "${sha256}" "${work}/jdk.tar.gz" | sha256sum -c --quiet -
    mkdir -p "${JDK_HOME}"
    tar -xzf "${work}/jdk.tar.gz" -C "${JDK_HOME}" --strip-components=1
    rm -rf "${work}"
  fi
  # A build Renovate has moved past is left behind otherwise.
  find "$(dirname "${JDK_HOME}")" -maxdepth 1 -name 'temurin-*' ! -path "${JDK_HOME}" -exec rm -rf {} +
  # sdkmanager and avdmanager below run on JAVA_HOME; Flutter hands the JDK it is
  # configured with to Gradle.
  export JAVA_HOME="${JDK_HOME}"
  flutter config --jdk-dir "${JDK_HOME}" > /dev/null
}

# Prints the archive and SHA-1 of the newest stable command-line tools for Linux
# in the manifest at $1.
latest_cmdline_tools() {
  python3 - "$1" << 'PY'
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
stable = next(c.get("id") for c in root.iter("channel") if c.text == "stable")
candidates = []
for package in root.iter("remotePackage"):
    if not package.get("path", "").startswith("cmdline-tools;"):
        continue
    if package.find("channelRef").get("ref") != stable:
        continue
    revision = tuple(int(part.text) for part in package.find("revision"))
    for archive in package.iter("archive"):
        if archive.findtext("host-os") == "linux":
            complete = archive.find("complete")
            candidates.append((revision, complete.findtext("url"), complete.findtext("checksum")))
_, url, sha1 = max(candidates)
print(url, sha1)
PY
}

install_cmdline_tools() {
  [[ -x "${sdkmanager}" ]] && return 0
  local work latest archive sha1
  work="$(mktemp -d)"
  curl -fsSL -o "${work}/repository.xml" "${REPOSITORY_URL}/repository2-3.xml"
  latest="$(latest_cmdline_tools "${work}/repository.xml")"
  read -r archive sha1 <<< "${latest}"
  android_log "downloading ${archive}"
  curl -fsSL -o "${work}/tools.zip" "${REPOSITORY_URL}/${archive}"
  printf '%s  %s\n' "${sha1}" "${work}/tools.zip" | sha1sum -c --quiet -
  unzip -q "${work}/tools.zip" -d "${work}"
  mkdir -p "${ANDROID_HOME}/cmdline-tools"
  rm -rf "${ANDROID_HOME}/cmdline-tools/latest"
  mv "${work}/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"
  rm -rf "${work}"
}

# sdkmanager shows each license the packages come under and asks the person
# running this to accept it; nothing here answers for them.
install_packages() {
  local packages=(platform-tools emulator "${ANDROID_SYSTEM_IMAGE}")
  local missing=() package
  for package in "${packages[@]}"; do
    [[ -d "${ANDROID_HOME}/${package//;//}" ]] || missing+=("${package}")
  done
  [[ "${#missing[@]}" -eq 0 ]] && return 0
  [[ -t 0 ]] ||
    android_die "run this from a terminal: sdkmanager asks you to accept the Android SDK license before it installs ${missing[*]}"
  android_log "installing ${missing[*]}"
  "${sdkmanager}" --install "${missing[@]}"
}

create_avd() {
  if "${avdmanager}" list avd -c 2> /dev/null | grep -qx "${ANDROID_AVD_NAME}"; then
    return 0
  fi
  android_log "creating the ${ANDROID_AVD_NAME} emulator (${ANDROID_DEVICE_PROFILE})"
  # avdmanager writes the AVD and then exits non-zero complaining that the
  # default image ships no devices.xml, so the check is whether the AVD exists.
  printf 'no\n' | "${avdmanager}" create avd \
    --name "${ANDROID_AVD_NAME}" \
    --package "${ANDROID_SYSTEM_IMAGE}" \
    --device "${ANDROID_DEVICE_PROFILE}" > /dev/null 2>&1 || true
  "${avdmanager}" list avd -c 2> /dev/null | grep -qx "${ANDROID_AVD_NAME}" ||
    android_die "avdmanager did not create ${ANDROID_AVD_NAME}"
  # The profile's 10 GB data partition makes the emulator refuse to boot with
  # less than 12 GB free, and the app needs a fraction of it.
  sed -i 's/^disk\.dataPartition\.size=.*/disk.dataPartition.size=4G/' \
    "${HOME}/.android/avd/${ANDROID_AVD_NAME}.avd/config.ini"
}

# /dev/kvm reaches the container owned by the host's kvm GID, which the image
# has no group for, so the emulator cannot open it until the user is in one.
grant_kvm() {
  local gid group
  gid="$(stat -c %g /dev/kvm)"
  group="$(getent group "${gid}" | cut -d: -f1 || true)"
  if [[ -z "${group}" ]]; then
    group='kvm'
    getent group "${group}" > /dev/null &&
      android_die "a group named ${group} exists with a GID other than /dev/kvm's ${gid}"
    sudo groupadd --gid "${gid}" "${group}"
  fi
  if ! id -nG "${USER}" | tr ' ' '\n' | grep -qx "${group}"; then
    android_log "adding ${USER} to ${group}, the group /dev/kvm belongs to"
    sudo usermod -aG "${group}" "${USER}"
  fi
}

# The scripts under mobile/scripts look adb up on PATH, which ~/.local/bin is on.
link_adb() {
  mkdir -p "${HOME}/.local/bin"
  ln -sfn "${ANDROID_HOME}/platform-tools/adb" "${HOME}/.local/bin/adb"
}

# mobile/android/gradle.properties gives the daemon 8 GB, which beside a running
# emulator and the development stack gets the container OOM-killed. Gradle
# reads the user's properties over the project's, so this caps local builds only.
limit_gradle_heap() {
  local properties="${GRADLE_USER_HOME:-${HOME}/.gradle}/gradle.properties"
  if [[ -f "${properties}" ]] && grep -q '^org.gradle.jvmargs=' "${properties}"; then
    return 0
  fi
  mkdir -p "$(dirname "${properties}")"
  cat >> "${properties}" << 'EOF'
org.gradle.jvmargs=-Xmx3G -XX:MaxMetaspaceSize=1G -XX:+HeapDumpOnOutOfMemoryError
kotlin.daemon.jvmargs=-Xmx1536m
EOF
}

require_host
install_jdk
install_cmdline_tools
install_packages
create_avd
grant_kvm
link_adb
limit_gradle_heap

android_log "installed under ${ANDROID_HOME}; start the emulator with: task mobile:emulator-start"
