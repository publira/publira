#!/usr/bin/env bash
# Where the Android SDK and the emulator live in the Dev Container, shared by
# the script that installs them and the one that boots the emulator.
# shellcheck shell=bash disable=SC2034 # read by the scripts that source this file

# Flutter looks here on Linux when neither ANDROID_HOME nor its own config names
# an SDK, so an install in this place needs no `flutter config`.
ANDROID_HOME="${ANDROID_HOME:-${HOME}/Android/Sdk}"
export ANDROID_HOME

# The image `Test / Mobile E2E` boots: the emulator runner's default target at
# the API level and architecture ci.yml names.
readonly ANDROID_SYSTEM_IMAGE='system-images;android-34;default;x86_64'
# The phone `task mobile:screenshot` photographs as when it falls back to a
# browser, so both paths draw the same screen size.
readonly ANDROID_DEVICE_PROFILE='pixel_7'
ANDROID_AVD_NAME="${MOBILE_AVD_NAME:-publira-pixel-7}"

android_log() {
  printf 'android: %s\n' "$*"
}

android_die() {
  printf 'android: %s\n' "$*" >&2
  exit 1
}
