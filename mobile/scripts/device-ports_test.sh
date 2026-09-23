#!/usr/bin/env bash
# Runs e2e-test.sh against stubbed `adb`, `flutter`, and `dart`, and checks
# which address each kind of device is given and whether the E2E stack's port
# is reversed onto it. CI's mobile E2E only ever runs on an emulator, so the
# physical-device path is exercised here and nowhere else.
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
printf 'adb %s\n' "$*" >> "${STUB_LOG}"
case "$2" in
  R5CT* | emulator-*) ;;
  *) exit 1 ;;
esac
[[ "$3" == shell ]] && printf 'HTTP/1.0 404 Not Found\n'
exit 0
EOF
cat > "${stub_bin}/flutter" << 'EOF'
#!/usr/bin/env bash
printf 'flutter %s\n' "$*" >> "${STUB_LOG}"
EOF
cat > "${stub_bin}/dart" << 'EOF'
#!/usr/bin/env bash
EOF
chmod +x "${stub_bin}/adb" "${stub_bin}/flutter" "${stub_bin}/dart"

port=18123

# Runs e2e-test.sh on device $1 and leaves the stubs' calls in ${log}.
run_on() {
  log="${test_dir}/$1.log"
  : > "${log}"
  env -u PUBLIRA_BASE_URL -u PUBLIRA_TENANT_HOST \
    PATH="${stub_bin}:${PATH}" \
    STUB_LOG="${log}" \
    PUBLIRA_E2E_RUN_DIR="${test_dir}/run" \
    PUBLIRA_E2E_MOBILE_DEVICE="$1" \
    PUBLIRA_E2E_PUBLIC_API_PORT="${port}" \
    PUBLIRA_LIVE_API=true \
    bash "${MOBILE_SCRIPTS_DIR}/e2e-test.sh" > /dev/null 2>&1 ||
    fail "e2e-test.sh on $1 exited with $?"
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

[[ "${failures}" -eq 0 ]]
