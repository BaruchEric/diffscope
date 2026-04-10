#!/usr/bin/env bash
# Bun's install strips the execute bit from prebuilt native helper binaries.
# node-pty's `spawn-helper` must be executable or spawning a PTY fails with
# `posix_spawnp failed`. Re-apply the bit after every install.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
for f in \
  "$root/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper" \
  "$root/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper" \
  "$root/node_modules/node-pty/prebuilds/linux-x64/spawn-helper" \
  "$root/node_modules/node-pty/prebuilds/linux-arm64/spawn-helper"; do
  if [ -f "$f" ]; then
    chmod +x "$f"
  fi
done
