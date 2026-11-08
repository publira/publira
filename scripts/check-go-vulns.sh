#!/usr/bin/env bash
# check-go-vulns.sh — Fail when the server reaches a Go vulnerability that
# server/govulncheck-ignore.json does not accept, or accepts past its expiry.
#
#     scripts/check-go-vulns.sh              # every finding of this checkout
#     scripts/check-go-vulns.sh origin/main  # only what this checkout adds to origin/main
#
# Given a base commit, the script scans that commit too, in a worktree of its
# own, and a finding the base reaches as well is a warning: the change did not
# bring it. An expired entry fails either way.
#
# govulncheck has no ignore file of its own, and its JSON output exits zero
# whatever it finds, so scripts/go-vulns.ts reads that output and decides.
# CI runs this script in `Scan / Go`; run it locally before pushing a
# dependency change. Like `Lint / Go`, it needs the libvips headers, since
# loading the packages runs cgo.
set -euo pipefail

# renovate: datasource=go depName=golang.org/x/vuln
GOVULNCHECK_VERSION=v1.9.0

base="${1:-}"
repo_root="$(git rev-parse --show-toplevel)"
scratch="$(mktemp -d)"
base_tree="${scratch}/base"

cleanup() {
  if [[ -d "${base_tree}" ]]; then
    git -C "${repo_root}" worktree remove --force "${base_tree}"
  fi
  rm -rf "${scratch}"
}
trap cleanup EXIT

# A load or build error exits non-zero with the reason on stderr, and the
# output would hold no findings to read, so it stops the script here.
scan() {
  (
    cd "$1/server"
    go run "golang.org/x/vuln/cmd/govulncheck@${GOVULNCHECK_VERSION}" -format json ./... > "$2"
  )
}

scan "${repo_root}" "${scratch}/head.json"

args=(server/govulncheck-ignore.json)
if [[ -n "${base}" ]]; then
  git -C "${repo_root}" worktree add --quiet --detach "${base_tree}" "${base}"
  scan "${base_tree}" "${scratch}/base.json"
  args+=(--base "${scratch}/base.json")
fi

cd "${repo_root}"
node scripts/go-vulns.ts "${args[@]}" < "${scratch}/head.json"
