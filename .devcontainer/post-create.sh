#!/usr/bin/env bash

set -euo pipefail

sudo chown -R vscode:vscode \
  /home/vscode/.claude \
  /home/vscode/.codex \
  /home/vscode/.config/gh \
  /home/vscode/.gemini \
  /home/vscode/.grok \
  /home/vscode/.local

# A new volume is created owned by root, and everything inside these is written
# by vscode, so only the mount points need it. Recursing would walk the 100k-odd
# files of the Gradle caches on every rebuild.
sudo chown vscode:vscode \
  /home/vscode/.android \
  /home/vscode/.gradle \
  /home/vscode/Android

task setup
task db:setup
