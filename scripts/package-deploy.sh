#!/usr/bin/env bash
# package-deploy.sh — Write publira-deploy-<version>.tar.gz, the Compose
# install as a release publishes it, into a directory, and print its path.
#
#   bash scripts/package-deploy.sh 0.3.0 dist/
#
# The archive holds infra/deploy/ under one directory, publira-deploy-<version>/,
# with the files an install runs from and nothing else: Taskfile.yaml is the
# repository's own. The Caddyfile is a link into infra/proxy/ in the
# repository and a regular file in the archive, so the archive runs without a
# checkout beside it. `.env.example` names the images of the version the
# archive is made for, which is what keeps the images and the Compose file of
# one release together.
#
# `task deploy:check` and `task deploy:smoke` run the install from an archive
# this script writes, so a file compose.yaml needs that the list below leaves
# out fails there. The `Publish release` job attaches the archive to the
# Release.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <version> <output directory>" >&2
  exit 2
fi
version="$1"
# The version is written into a file name and a sed expression.
if ! [[ "${version}" =~ ^[0-9A-Za-z.-]+$ ]]; then
  echo "${version} is not a release version." >&2
  exit 2
fi
out_dir="$(cd "$2" && pwd)"

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

name="publira-deploy-${version}"
files=(compose.yaml .env.example Caddyfile README.md)

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
mkdir "${work}/${name}"

for file in "${files[@]}"; do
  # -L writes the file a link points to, as a regular file.
  cp -L "infra/deploy/${file}" "${work}/${name}/${file}"
done

if ! grep -qx 'PUBLIRA_IMAGE_TAG=' "${work}/${name}/.env.example"; then
  echo "infra/deploy/.env.example does not leave PUBLIRA_IMAGE_TAG empty for the archive to set." >&2
  exit 1
fi
sed -i "s/^PUBLIRA_IMAGE_TAG=\$/PUBLIRA_IMAGE_TAG=${version}/" "${work}/${name}/.env.example"

# The commit's time and no owner, so the same commit writes the same archive
# on any machine.
mtime="$(git log -1 --format=%cI HEAD)"
tar -C "${work}" --sort=name --mtime="${mtime}" --owner=0 --group=0 --numeric-owner \
  -cf - "${name}" | gzip -9n > "${out_dir}/${name}.tar.gz"

echo "${out_dir}/${name}.tar.gz"
