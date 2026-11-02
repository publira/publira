#!/usr/bin/env bash
# Runs e2e-test.sh against stubbed `adb`, `flutter`, and `dart`, and checks
# which address each kind of device is given, whether the E2E stack's port
# is reversed onto it, and which artifacts a failing run collects from it.
# CI's mobile E2E only ever runs on an emulator, so the physical-device and
# Linux desktop paths are exercised here and nowhere else.
set -euo pipefail

MOBILE_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

failures=0
fail() {
  printf 'not ok - %s\n' "$*" >&2
  failures=$((failures + 1))
}

pass() {
  printf 'ok - %s\n' "$*"
}

stub_bin="${test_dir}/bin"
mkdir -p "${stub_bin}"
# adb answers for `R5CT*` (a phone on a cable) and `emulator-*` serials only,
# and every emulator reaches the API at once.
cat > "${stub_bin}/adb" << 'EOF'
#!/usr/bin/env bash
printf 'adb %s\n' "$*" >> "${PUBLIRA_STUB_LOG}"
case "$2" in
  R5CT* | emulator-*) ;;
  *) exit 1 ;;
esac
[[ "$3" == shell ]] && printf 'HTTP/1.0 404 Not Found\n'
exit 0
EOF
# `flutter test` exits with PUBLIRA_STUB_TEST_STATUS, and a failure leaves a
# screenshot where the Linux desktop build writes them.
cat > "${stub_bin}/flutter" << 'EOF'
#!/usr/bin/env bash
printf 'flutter %s\n' "$*" >> "${PUBLIRA_STUB_LOG}"
if [[ "$1" == test && "${PUBLIRA_STUB_TEST_STATUS}" -ne 0 ]]; then
  mkdir -p "${TMPDIR}/publira-integration"
  : > "${TMPDIR}/publira-integration/failure.png"
  exit "${PUBLIRA_STUB_TEST_STATUS}"
fi
EOF
cat > "${stub_bin}/dart" << 'EOF'
#!/usr/bin/env bash
EOF
# The Linux desktop's session: each wrapper logs itself and runs its command.
cat > "${stub_bin}/dbus-run-session" << 'EOF'
#!/usr/bin/env bash
printf 'dbus-run-session\n' >> "${PUBLIRA_STUB_LOG}"
shift
exec "$@"
EOF
cat > "${stub_bin}/xvfb-run" << 'EOF'
#!/usr/bin/env bash
printf 'xvfb-run\n' >> "${PUBLIRA_STUB_LOG}"
while [[ "$1" == --* ]]; do shift; done
exec "$@"
EOF
cat > "${stub_bin}/xauth" << 'EOF'
#!/usr/bin/env bash
EOF
cat > "${stub_bin}/gnome-keyring-daemon" << 'EOF'
#!/usr/bin/env bash
cat > /dev/null
EOF
cat > "${stub_bin}/pkg-config" << 'EOF'
#!/usr/bin/env bash
EOF
chmod +x "${stub_bin}"/*

port=18123

# Runs e2e-test.sh on device $1 with `flutter test` exiting with $2 (0 when
# omitted), checks the script exits with the same status, and leaves the
# stubs' calls in ${log} and the run's artifacts under ${artifacts}.
run_on() {
  local expected="${2:-0}" status=0
  log="${test_dir}/$1.log"
  artifacts="${test_dir}/run-$1-${expected}/artifacts"
  : > "${log}"
  env -u PUBLIRA_BASE_URL -u PUBLIRA_TENANT_HOST \
    PATH="${stub_bin}:${PATH}" \
    PUBLIRA_STUB_LOG="${log}" \
    PUBLIRA_STUB_TEST_STATUS="${expected}" \
    PUBLIRA_E2E_RUN_DIR="${artifacts%/artifacts}" \
    PUBLIRA_E2E_MOBILE_DEVICE="$1" \
    PUBLIRA_E2E_PUBLIC_API_PORT="${port}" \
    PUBLIRA_LIVE_API=true \
    bash "${MOBILE_SCRIPTS_DIR}/e2e-test.sh" > /dev/null 2>&1 || status=$?
  if [[ "${status}" -ne "${expected}" ]]; then
    fail "e2e-test.sh on $1 exited with ${status}, not ${expected}"
  fi
}

run_on R5CT123
reverse_line="$(grep -n "^adb -s R5CT123 reverse tcp:${port} tcp:${port}$" "${log}" | cut -d: -f1 || true)"
test_line="$(grep -n '^flutter test integration_test -d R5CT123 ' "${log}" | cut -d: -f1 || true)"
if [[ -n "${reverse_line}" && -n "${test_line}" && "${reverse_line}" -lt "${test_line}" ]]; then
  pass "a physical device has the E2E port reversed onto it before flutter test"
else
  fail "a physical device was not given tcp:${port} before flutter test: $(cat "${log}")"
fi
if grep -q "PUBLIRA_BASE_URL=http://127.0.0.1:${port}" "${log}"; then
  pass "a physical device is given its own loopback"
else
  fail "a physical device was given another address: $(cat "${log}")"
fi

run_on emulator-5554
if grep -q ' reverse ' "${log}"; then
  fail "an emulator had a port reversed: $(cat "${log}")"
else
  pass "an emulator has no port reversed"
fi
if grep -q "PUBLIRA_BASE_URL=http://10.0.2.2:${port}" "${log}"; then
  pass "an emulator is given 10.0.2.2"
else
  fail "an emulator was given another address: $(cat "${log}")"
fi

run_on linux
if grep -q ' reverse ' "${log}"; then
  fail "a target adb does not answer for had a port reversed: $(cat "${log}")"
else
  pass "a target adb does not answer for has no port reversed"
fi
if grep -q "PUBLIRA_BASE_URL=http://127.0.0.1:${port}" "${log}"; then
  pass "a target adb does not answer for is given loopback"
else
  fail "a target adb does not answer for was given another address: $(cat "${log}")"
fi
if [[ "$(grep -oE '^(dbus-run-session|xvfb-run|flutter test)' "${log}")" == $'dbus-run-session\nxvfb-run\nflutter test' ]]; then
  pass "the Linux desktop runs flutter test under Xvfb in a D-Bus session"
else
  fail "the Linux desktop ran flutter test outside its session: $(cat "${log}")"
fi

# Any adb command but get-state waits for the device to appear, and the Linux
# desktop never does.
run_on linux 1
if grep -E '^adb -s linux ' "${log}" | grep -qv ' get-state$'; then
  fail "a failing run on a target adb does not answer for asked adb for its artifacts: $(cat "${log}")"
else
  pass "a failing run on a target adb does not answer for asks adb only whether it answers"
fi
if [[ -f "${artifacts}/screenshots/failure.png" ]]; then
  pass "a failing run on the Linux desktop keeps its screenshots"
else
  fail "a failing run on the Linux desktop lost its screenshots: $(find "${artifacts}" 2>&1)"
fi

run_on emulator-5554 1
if grep -q '^adb -s emulator-5554 logcat -d$' "${log}"; then
  pass "a failing run on an emulator collects its logcat"
else
  fail "a failing run on an emulator did not collect its logcat: $(cat "${log}")"
fi

[[ "${failures}" -eq 0 ]]
