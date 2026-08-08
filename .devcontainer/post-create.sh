#!/usr/bin/env bash

set -euo pipefail

sudo chown -R vscode:vscode \
  /home/vscode/.claude \
  /home/vscode/.codex \
  /home/vscode/.config/gh \
  /home/vscode/.grok \
  /home/vscode/.local/share/pnpm/store

task setup
task db:setup
