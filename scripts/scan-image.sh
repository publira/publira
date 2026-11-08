#!/usr/bin/env bash
# scan-image.sh — Scan one architecture of a release image with Trivy, and
# write beside the scan the layers of the image it is built on.
#
#   scripts/scan-image.sh ghcr.io/publira/publira@sha256:… arm64 scan/publira/arm64
#
# The reference names the image the build pushed, an index holding one
# platform and its attestation manifest, by digest or by tag. The directory
# receives two files that scripts/image-vulns.ts reads:
#
#   trivy.json  the critical findings, as `trivy image --format json` writes them
#   base.json   {"name", "digest", "diffIds"}: the image the final stage of the
#               Dockerfile starts FROM, and its layers for this architecture
#
# The base comes from the image's own `org.opencontainers.image.base.name`
# and `.base.digest` annotations, which `Release images` writes at build time,
# so the scan needs nothing from the commit the image was built from. An
# image built without them fails here.
#
# `Images / Scan` runs this for every image and architecture a release builds.
# It needs `trivy` on the PATH, and `docker login ghcr.io` for a package that
# is not public yet.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <image reference> <amd64|arm64> <output directory>" >&2
  exit 2
fi
ref="$1"
arch="$2"
out="$3"
repo="${ref%@*}"
# A tag sits after the last `/`; a colon before it is a registry's port.
if [[ "${repo##*/}" == *:* ]]; then
  repo="${repo%:*}"
fi
platform="linux/${arch}"

manifest="$(
  docker buildx imagetools inspect --raw "${ref}" |
    jq -r --arg arch "${arch}" '
      if .manifests then
        [.manifests[] | select(.platform.os == "linux" and .platform.architecture == $arch) | .digest] | first // empty
      else
        empty
      end'
)"
if [[ -z "${manifest}" ]]; then
  echo "${ref} holds no ${platform} image." >&2
  exit 1
fi

annotations="$(docker buildx imagetools inspect --raw "${repo}@${manifest}" | jq -c '.annotations // {}')"
base_name="$(jq -r '."org.opencontainers.image.base.name" // empty' <<< "${annotations}")"
base_digest="$(jq -r '."org.opencontainers.image.base.digest" // empty' <<< "${annotations}")"
if [[ -z "${base_name}" || -z "${base_digest}" ]]; then
  echo "${repo}@${manifest} (${platform}) carries no org.opencontainers.image.base.name and .base.digest annotations, so its base layers cannot be told apart from its own." >&2
  exit 1
fi

# A multi-platform base inspects as a map from platform to image, keyed with
# the variant when the index gives one (linux/arm64/v8); a single-platform
# base inspects as the image itself.
diff_ids="$(
  docker buildx imagetools inspect "${base_name}@${base_digest}" --format '{{json .Image}}' |
    jq -c --arg platform "${platform}" '
      if has("rootfs") then
        .rootfs.diff_ids
      else
        [to_entries[] | select(.key == $platform or (.key | startswith($platform + "/"))) | .value.rootfs.diff_ids] | first
      end // empty'
)"
if [[ -z "${diff_ids}" ]]; then
  echo "${base_name}@${base_digest} holds no ${platform} image." >&2
  exit 1
fi

mkdir -p "${out}"
jq -n --arg name "${base_name}" --arg digest "${base_digest}" --argjson diffIds "${diff_ids}" \
  '{name: $name, digest: $digest, diffIds: $diffIds}' > "${out}/base.json"

# Read from the registry, so the scan needs no Docker daemon to hold the
# image, and limited to critical findings, the only ones the release is held
# to. The exit code says whether the scan ran, not what it found:
# scripts/image-vulns.ts judges the findings.
trivy image \
  --quiet \
  --skip-version-check \
  --disable-telemetry \
  --image-src remote \
  --scanners vuln \
  --severity CRITICAL \
  --format json \
  --output "${out}/trivy.json" \
  "${repo}@${manifest}"
