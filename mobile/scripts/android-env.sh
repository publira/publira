#!/usr/bin/env bash
# Where the Android SDK and the emulator live in the Dev Container, and the
# image they boot, shared by the scripts that install and boot the emulator
# here and in CI.
# shellcheck shell=bash disable=SC2034 # read by the scripts that source this file

# Flutter looks here on Linux when neither ANDROID_HOME nor its own config names
# an SDK, so an install in this place needs no `flutter config`.
ANDROID_HOME="${ANDROID_HOME:-${HOME}/Android/Sdk}"
export ANDROID_HOME

# The image `Test / Mobile E2E` boots, which emulator-packages.sh hands to the
# emulator runner in ci.yml.
readonly ANDROID_SYSTEM_IMAGE='system-images;android-34;default;x86_64'
# The hardware profile the AVD is created with. The default is the phone
# `task mobile:screenshot` photographs as when it falls back to a browser, so
# both paths draw the same screen size; a tablet profile such as pixel_tablet,
# under an AVD name of its own, is how the app is tried at a tablet's width.
ANDROID_DEVICE_PROFILE="${PUBLIRA_MOBILE_AVD_DEVICE:-pixel_7}"
ANDROID_AVD_NAME="${PUBLIRA_MOBILE_AVD_NAME:-publira-pixel-7}"

android_log() {
  printf 'android: %s\n' "$*"
}

android_die() {
  printf 'android: %s\n' "$*" >&2
  exit 1
}
