#!/usr/bin/env bash
# go-test-share.sh — Print the import paths of the server packages in one share
# of `Test / Go`, one per line.
#
# Usage: scripts/go-test-share.sh search|api|other
#
# CI runs each share on a runner of its own, and `go test` on one runner keeps
# every core busy, so the shares are balanced by how long their packages take.
# Every package `go test ./...` finds lands in exactly one share: it is placed
# by the first rule below that matches it, and `other` takes whatever none
# does, so a package added later is tested without anyone listing it.
#
#   search  Packages whose tests start an OpenSearch or Elasticsearch node, and
#           the only share whose job builds the images those nodes run on.
#   api     The API packages under api/, of which publicapi and adminapi are
#           the two longest packages of all.
#   other   Everything else.
set -euo pipefail

share="${1:-}"
case "${share}" in
  search | api | other) ;;
  *)
    echo "usage: $0 search|api|other" >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}/server"

module="$(go list -m)"

# The helpers that start a node are every exported function in the files of
# internal/testutil that hold them, so a helper added there is found too. A
# package that starts a node some other way lands in another share and still
# passes, but builds both images itself before its first test.
search_helpers="$(
  sed -nE 's/^func ([A-Z][A-Za-z0-9]*)\(.*/\1/p' \
    internal/testutil/searchengine.go \
    internal/testutil/opensearch.go \
    internal/testutil/elasticsearch.go |
    paste -sd '|'
)"
search_packages="$(
  git grep -lE "testutil\.(${search_helpers})\(" -- '*_test.go' |
    xargs -r -n 1 dirname |
    sed "s#^#${module}/#" |
    sort -u
)"

go list ./... | while read -r package; do
  if grep -qxF "${package}" <<< "${search_packages}"; then
    package_share=search
  elif [[ "${package}" == "${module}/api/"* ]]; then
    package_share=api
  else
    package_share=other
  fi
  if [[ "${package_share}" == "${share}" ]]; then
    echo "${package}"
  fi
done
