#!/usr/bin/env bash
# Builds the iOS app with Xcode and checks that the identity generated from an
# app manifest reached the built app: the dev flavor for the simulator from
# Publira's own manifest, then the production flavor, unsigned, from a manifest
# whose app name Xcode would misread if it were not escaped. Needs macOS with
# Xcode, and `task mobile:deps` run first.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${MOBILE_DIR}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

simulator_app=build/ios/iphonesimulator/Runner.app
device_app=build/ios/iphoneos/Runner.app

fail() {
  echo "error: $*" >&2
  exit 1
}

# $1 is the app, $2 a key of its Info.plist, $3 the value it has to hold.
expect_info() {
  local actual
  actual="$(/usr/libexec/PlistBuddy -c "Print :$2" "$1/Info.plist")"
  [[ "${actual}" == "$3" ]] || fail "$1: $2 is '${actual}', not '$3'"
  echo "$1: $2 = ${actual}"
}

# A simulator build carries its entitlements in the executable's
# __TEXT,__entitlements section, where a device build signs them in.
expect_associated_domain() {
  local executable="$1/Runner" thin="${work}/Runner" actual
  rm -f "${thin}" "${work}/entitlements.plist"
  xcrun lipo "${executable}" -thin "$(xcrun lipo -archs "${executable}" | cut -d' ' -f1)" \
    -output "${thin}" 2> /dev/null || cp "${executable}" "${thin}"
  xcrun segedit "${thin}" -extract __TEXT __entitlements "${work}/entitlements.plist"
  actual="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.associated-domains:0' \
    "${work}/entitlements.plist")"
  [[ "${actual}" == "$2" ]] || fail "$1: the associated domain is '${actual}', not '$2'"
  echo "$1: com.apple.developer.associated-domains = ${actual}"
}

status_before="$(git status --porcelain --untracked-files=all)"

echo '--- dev flavor, simulator, Publira'"'"'s own manifest'
dart run scripts/app_manifest.dart --generate
flutter build ios --simulator --debug --flavor dev
expect_info "${simulator_app}" CFBundleIdentifier dev.publira.app.dev
expect_info "${simulator_app}" CFBundleDisplayName 'Publira Dev'
expect_associated_domain "${simulator_app}" 'applinks:localhost?mode=developer'

# `//` starts an xcconfig comment, `$(...)` a reference, and a trailing `;` is
# dropped, so each reaches the app only when the generator escaped it.
app_name='Reader // $(HOME) $5 Club;'
manifest="${work}/app.yaml"
cat > "${manifest}" << YAML
schemaVersion: 1
app:
  name: '${app_name}'
tenant:
  host: reader.example.com
android:
  applicationId: com.example.reader
ios:
  bundleIdentifier: com.example.reader
YAML
export PUBLIRA_BASE_URL=https://reader.example.com

echo '--- production flavor, simulator, a tenant manifest'
dart run scripts/build.dart "${manifest}" ios --simulator --debug
expect_info "${simulator_app}" CFBundleIdentifier com.example.reader
expect_info "${simulator_app}" CFBundleDisplayName "${app_name}"
expect_associated_domain "${simulator_app}" 'applinks:reader.example.com?mode=developer'

echo '--- production flavor refusing another tenant host'
# Straight to Flutter, since scripts/build.dart refuses a host of its own.
if flutter build ios --simulator --debug --flavor production \
  --dart-define=PUBLIRA_TENANT_HOST=other.example.com \
  --dart-define=PUBLIRA_BASE_URL="${PUBLIRA_BASE_URL}" 2>&1 | tee "${work}/refused.log"; then
  fail 'a production build for another tenant host was not refused'
fi
grep -F 'Production builds require --dart-define=PUBLIRA_TENANT_HOST=reader.example.com' \
  "${work}/refused.log" > /dev/null ||
  fail 'the production build failed without the tenant host check refusing it'

echo '--- production flavor, device, unsigned, a tenant manifest'
dart run scripts/build.dart "${manifest}" ios --no-codesign
expect_info "${device_app}" CFBundleIdentifier com.example.reader
expect_info "${device_app}" CFBundleDisplayName "${app_name}"

# An unsigned build carries no entitlements, and iOS refuses ad hoc signing,
# so the store configuration's are checked where Xcode resolves them from.
release_settings="$(xcodebuild -project ios/Runner.xcodeproj -target Runner \
  -configuration Release-production -showBuildSettings 2> /dev/null)"
release_setting() {
  awk -v name="$1" '$1 == name && $2 == "=" { sub(/^[^=]*= /, ""); print; exit }' \
    <<< "${release_settings}"
}
entitlements="$(release_setting CODE_SIGN_ENTITLEMENTS)"
[[ "${entitlements}" == Runner/RunnerRelease.entitlements ]] ||
  fail "Release-production signs with '${entitlements}', not Runner/RunnerRelease.entitlements"
[[ "$(release_setting PUBLIRA_ASSOCIATED_DOMAIN)" == reader.example.com ]] ||
  fail "Release-production resolves PUBLIRA_ASSOCIATED_DOMAIN to '$(release_setting PUBLIRA_ASSOCIATED_DOMAIN)'"
# shellcheck disable=SC2016 # The reference Xcode expands, written literally.
domain='applinks:$(PUBLIRA_ASSOCIATED_DOMAIN)'
[[ "$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.associated-domains:0' \
  "ios/${entitlements}")" == "${domain}" ]] ||
  fail "ios/${entitlements} does not claim ${domain}"
echo "Release-production: ${entitlements} claims ${domain} = applinks:reader.example.com"

status_after="$(git status --porcelain --untracked-files=all)"
if [[ "${status_after}" != "${status_before}" ]]; then
  echo "${status_after}" >&2
  fail 'the builds changed files Git tracks or does not ignore'
fi
