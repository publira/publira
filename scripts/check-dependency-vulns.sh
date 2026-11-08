#!/usr/bin/env bash
# check-dependency-vulns.sh — Fail when pnpm-lock.yaml or mobile/pubspec.lock
# holds a package version with a high or critical advisory that
# osv-scanner.toml does not accept, or accepts past its date.
#
#     scripts/check-dependency-vulns.sh              # every finding of this checkout
#     scripts/check-dependency-vulns.sh origin/main  # only what this checkout adds to origin/main
#
# Given a base commit, the script scans that commit's lock files too, and a
# finding the base carries as well is a warning: the change did not bring it.
# An expired entry fails either way.
#
# osv-scanner applies the IgnoredVulns of an osv-scanner.toml by itself, but
# drops what it ignores from its output, cannot say when an ignore expired,
# and has no severity threshold, so it runs here with an empty configuration
# and scripts/dependency-vulns.ts reads the findings against osv-scanner.toml.
# CI runs this script in `Scan / Dependencies`; run it locally before pushing
# a dependency change. It needs `osv-scanner` on the PATH, at the
# OSV_SCANNER_VERSION of .github/workflows/ci.yml, and `pnpm install` for the
# TOML parser the script imports.
set -euo pipefail

lockfiles=(pnpm-lock.yaml mobile/pubspec.lock)

base="${1:-}"
repo_root="$(git rev-parse --show-toplevel)"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
: > "${scratch}/empty.toml"

# osv-scanner exits 1 when it finds anything and 0 when it finds nothing;
# any other status is a scan that did not run, with the reason on stderr.
scan() {
  local root="$1" output="$2" args=() status=0 file
  for file in "${lockfiles[@]}"; do
    if [[ -f "${root}/${file}" ]]; then
      args+=(--lockfile "${root}/${file}")
    fi
  done
  if ((${#args[@]} == 0)); then
    echo '{"results": []}' > "${output}"
    return
  fi
  osv-scanner scan source \
    --config "${scratch}/empty.toml" \
    --format json \
    --output-file "${output}" \
    --verbosity error \
    "${args[@]}" || status=$?
  if ((status > 1)); then
    echo "osv-scanner exited with ${status}." >&2
    exit "${status}"
  fi
}

cd "${repo_root}"
scan "${repo_root}" "${scratch}/head.json"

args=(osv-scanner.toml "${scratch}/head.json")
if [[ -n "${base}" ]]; then
  # The lock files are all the scan reads, so the base needs no checkout of
  # its own: a file the base does not have is left out of its scan.
  for file in "${lockfiles[@]}"; do
    if git cat-file -e "${base}:${file}" 2> /dev/null; then
      mkdir -p "${scratch}/base/$(dirname "${file}")"
      git show "${base}:${file}" > "${scratch}/base/${file}"
    fi
  done
  scan "${scratch}/base" "${scratch}/base.json"
  args+=(--base "${scratch}/base.json")
fi

node scripts/dependency-vulns.ts "${args[@]}"
