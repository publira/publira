#!/usr/bin/env bash
# Boot the emulator android-install.sh created, headless, or shut it down.
#   emulator.sh start   returns once Android has finished booting
#   emulator.sh stop    shuts down every running emulator
set -euo pipefail

# shellcheck source=./android-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/android-env.sh"

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly LOG_DIR="${MOBILE_DIR}/.run/logs"
readonly LOG_FILE="${LOG_DIR}/emulator.log"
readonly BOOT_TIMEOUT_SECONDS=300

command -v adb >/dev/null 2>&1 ||
  android_die "adb is not installed; run: task mobile:android-install"

running_emulators() {
  adb devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1 }'
}

start() {
  if [[ -n "$(running_emulators)" ]]; then
    android_log "already running: $(running_emulators | paste -sd ' ')"
    return 0
  fi
  [[ -d "${HOME}/.android/avd/${ANDROID_AVD_NAME}.avd" ]] ||
    android_die "no ${ANDROID_AVD_NAME} emulator; run: task mobile:android-install"

  # The options the emulator runner in ci.yml boots with.
  local command=(
    "${ANDROID_HOME}/emulator/emulator" -avd "${ANDROID_AVD_NAME}"
    -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim
  )
  local group
  group="$(stat -c %G /dev/kvm)"
  mkdir -p "${LOG_DIR}"
  android_log "booting ${ANDROID_AVD_NAME}; log in ${LOG_FILE}"
  # A shell started before android-install.sh added the user to the kvm group
  # does not carry it yet, and `sg` is what gives this one process the group.
  if [[ -r /dev/kvm && -w /dev/kvm ]]; then
    setsid nohup "${command[@]}" >"${LOG_FILE}" 2>&1 </dev/null &
  else
    setsid nohup sg "${group}" -c "$(printf '%q ' "${command[@]}")" >"${LOG_FILE}" 2>&1 </dev/null &
  fi
  local pid=$!

  local elapsed=0
  while [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != '1' ]]; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      tail -n 20 "${LOG_FILE}" >&2
      android_die "the emulator exited before it finished booting"
    fi
    [[ "${elapsed}" -lt "${BOOT_TIMEOUT_SECONDS}" ]] ||
      android_die "the emulator did not finish booting within ${BOOT_TIMEOUT_SECONDS}s; see ${LOG_FILE}"
    sleep 2
    elapsed=$((elapsed + 2))
  done
  android_log "booted: $(running_emulators | paste -sd ' ')"
}

stop() {
  local serial
  for serial in $(running_emulators); do
    android_log "stopping ${serial}"
    adb -s "${serial}" emu kill >/dev/null
  done
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) android_die "usage: emulator.sh start|stop" ;;
esac
