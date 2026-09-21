#!/bin/sh
# Run by Xcode as the Runner target's first build phase. Stops a build whose
# identity was not generated from an app manifest, was generated into a
# directory Xcode does not read, or, for a production build, names another
# tenant than the PUBLIRA_TENANT_HOST the app connects to.
set -eu

mobile_dir="$(cd "${SRCROOT}/.." && pwd -P)"
generate="in mobile/: dart run scripts/app_manifest.dart --generate [<manifest>]"

# Xcode reports a line starting with "error:" as a build error.
fail() {
  echo "error: $*" >&2
  exit 1
}

if [ -z "${PUBLIRA_BUNDLE_IDENTIFIER:-}" ]; then
  fail "${mobile_dir}/.generated/App.xcconfig does not exist. Generate it from an app manifest, ${generate}"
fi

# An xcconfig can include only a fixed path, so the directory the variable
# names reaches Gradle but not Xcode.
named="${PUBLIRA_MOBILE_GENERATED_DIR:-}"
if [ -n "${named}" ]; then
  case "${named}" in
    /*) ;;
    *) named="${mobile_dir}/${named}" ;;
  esac
  if [ "$(cd "${named}" 2> /dev/null && pwd -P)" != "$(cd "${mobile_dir}/.generated" && pwd -P)" ]; then
    fail "Xcode reads the build configuration from ${mobile_dir}/.generated only, not from PUBLIRA_MOBILE_GENERATED_DIR=${PUBLIRA_MOBILE_GENERATED_DIR}. Unset the variable and generate again, ${generate}"
  fi
fi

# A store binary is pinned to one tenant: the domain its Universal Links claim
# and the tenant the app asks the API about have to be the same.
case "${CONFIGURATION}" in
  *-production)
    tenant_host=""
    for define in $(printf '%s' "${DART_DEFINES:-}" | tr ',' ' '); do
      decoded="$(printf '%s' "${define}" | openssl base64 -d -A)"
      case "${decoded}" in
        PUBLIRA_TENANT_HOST=*) tenant_host="${decoded#PUBLIRA_TENANT_HOST=}" ;;
      esac
    done
    if [ "${tenant_host}" != "${PUBLIRA_ASSOCIATED_DOMAIN}" ]; then
      fail "Production builds require --dart-define=PUBLIRA_TENANT_HOST=${PUBLIRA_ASSOCIATED_DOMAIN}, the tenant.host of the app manifest"
    fi
    ;;
esac
