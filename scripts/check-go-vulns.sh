#!/usr/bin/env bash
# check-go-vulns.sh — Fail when the server reaches a Go vulnerability that
# server/govulncheck-ignore.json does not accept, or accepts past its expiry.
#
# govulncheck has no ignore file of its own, and its JSON output exits zero
# whatever it finds, so scripts/go-vulns.ts reads that output and decides.
# CI runs this script in `Scan / Go`; run it locally before pushing a
# dependency change. Like `Lint / Go`, it needs the libvips headers, since
# loading the packages runs cgo.
set -euo pipefail

# renovate: datasource=go depName=golang.org/x/vuln
GOVULNCHECK_VERSION=v1.9.0

repo_root="$(git rev-parse --show-toplevel)"
output="$(mktemp)"
trap 'rm -f "${output}"' EXIT

# A load or build error exits non-zero with the reason on stderr, and the
# output would hold no findings to read, so it stops the script here.
(
  cd "${repo_root}/server"
  go run "golang.org/x/vuln/cmd/govulncheck@${GOVULNCHECK_VERSION}" -format json ./... > "${output}"
)

cd "${repo_root}"
node scripts/go-vulns.ts server/govulncheck-ignore.json < "${output}"
