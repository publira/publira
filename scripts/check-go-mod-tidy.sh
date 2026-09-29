#!/usr/bin/env bash
# check-go-mod-tidy.sh — Fail when `go mod tidy` would change server/go.mod or
# server/go.sum.
#
# The build passes whether a directly imported module is marked `// indirect`
# or not, so an untidy go.mod only surfaces as an unrelated diff in whichever
# pull request next runs `task server:tidy`. CI runs the same script in
# `Lint / Go`.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}/server"

# `-diff` prints the changes tidy would make and exits non-zero instead of
# rewriting the files. It also exits non-zero when tidy itself fails, with the
# error on stderr and nothing on stdout, so only a non-empty diff means untidy.
status=0
diff="$(go mod tidy -diff)" || status=$?
if [[ -n "${diff}" ]]; then
  printf '%s\n' "${diff}"
  message="server/go.mod or server/go.sum is not tidy. Run 'task server:tidy' and commit the result."
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::error file=server/go.mod::${message}"
  else
    echo "${message}" >&2
  fi
  exit 1
fi
if ((status != 0)); then
  exit "${status}"
fi

echo "server/go.mod and server/go.sum match 'go mod tidy'."
