#!/usr/bin/env bash
# Removes the inner Docker daemon's images that arrived more than a week ago
# and that no container uses. Docker Engine never removes an image by itself,
# and the daemon's storage is a volume on the host's root filesystem that
# outlives rebuilds, so without this every image ever pulled or built stays
# there.
#
# With the containerd image store `until` compares against the time the image
# was pulled or built into this daemon — not the `Created` of its config, and
# not its last use — and an image any container references, running or
# stopped, is never removed. Volumes are left alone: they may hold data
# someone still needs.
#
# A volume first used by a daemon older than Docker 29 keeps the legacy image
# store, where `until` compares against the config's `Created` instead. There
# an upstream image released more than a week ago would be removed on every
# start however recently it was pulled, so the prune is skipped; recreating
# the `dind-var-lib-docker-*` volume moves the daemon to the containerd store.
#
# Runs on every start, when the docker-in-docker feature may still be bringing
# `dockerd` up, so it waits for the daemon for a bounded time and never fails:
# a skipped prune only postpones the cleanup to the next start.

set -uo pipefail

# The feature's own start-up gives up after about 30 seconds of retries, so a
# daemon that has not answered by then is not coming.
readonly timeout_seconds=60
readonly retention=168h

deadline=$((SECONDS + timeout_seconds))
until docker info > /dev/null 2>&1; do
  if ((SECONDS >= deadline)); then
    echo "post-start: dockerd did not answer within ${timeout_seconds}s; skipping the image prune" >&2
    exit 0
  fi
  sleep 1
done

if ! docker info --format '{{json .DriverStatus}}' | grep -q 'io.containerd.snapshotter.v1'; then
  echo "post-start: dockerd uses the legacy image store; skipping the image prune" >&2
  exit 0
fi

if ! docker image prune --all --force --filter "until=${retention}"; then
  echo "post-start: docker image prune failed; the images stay until the next start" >&2
fi
