#!/usr/bin/env bash

set -euo pipefail

sudo chown -R vscode:vscode \
  /home/vscode/.codex \
  /home/vscode/.config/gh \
  /home/vscode/.grok \
  /home/vscode/.local/share/pnpm/store

# package.json "packageManager" is the source of truth for pnpm (not Dev Container pins).
package_manager="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).packageManager)")"
corepack enable
corepack prepare "${package_manager}" --activate

task setup
task db:setup
