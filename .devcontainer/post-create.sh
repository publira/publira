#!/usr/bin/env bash

set -euo pipefail

sudo chown -R vscode:vscode \
  /home/vscode/.config/gh \
  /home/vscode/.grok

task setup
task db:setup
