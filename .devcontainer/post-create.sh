#!/usr/bin/env bash

set -euo pipefail

sudo chown -R vscode:vscode \
  /home/vscode/.claude \
  /home/vscode/.codex \
  /home/vscode/.config/gh \
  /home/vscode/.gemini \
  /home/vscode/.grok \
  /home/vscode/.local

# Node.js includes Corepack but does not enable its pnpm shim by default.
corepack enable
# Allow Corepack to fetch the package manager declared in package.json without
# prompting during non-interactive Dev Container creation.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

task setup
task db:setup
