#!/usr/bin/env bash

set -euo pipefail

sudo chown -R vscode:vscode \
  /home/vscode/.claude \
  /home/vscode/.codex \
  /home/vscode/.config/gh \
  /home/vscode/.gemini \
  /home/vscode/.grok \
  /home/vscode/.local

task setup
task db:setup
