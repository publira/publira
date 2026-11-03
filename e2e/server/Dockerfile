# The libraries `publira server` converts images with in the E2E stack.
#
# Image delivery hands every page, cover, and banner to libvips through
# Manael, and a browser that accepts AVIF gets one libheif encoded with libaom.
# Two releases of those libraries convert the same source into images that
# differ by a few pixels, and the screenshot projects compare the screen those
# images are drawn on pixel by pixel, so the libraries are pinned here instead
# of being whatever the machine running the stack happens to have.
# `scripts/server.sh` runs the server binary built on the host inside this
# image; nothing else in the stack converts an image.
#
# The binary is linked against the host's libvips and runs against this one,
# which works while the host's glibc is no newer than this image's: the Dev
# Container's Debian 13 and the `ubuntu-26.04` runners both qualify. Move the
# base image to a newer release when the runners move to one.
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c

# The libraries come from the `resolute` release pocket alone. That pocket is
# frozen at release: the index and the pool files it names never change
# afterwards, so the image resolves to the same bytes on every rebuild without
# a snapshot service in between. `resolute-updates` and `resolute-security`
# are deliberately absent, since they move and would give the libraries a
# second place to resolve from. The runtime packages depend on the base
# image's own libraries with lower bounds only, so the newer copies a rebuilt
# base image carries still satisfy them. Moving to another pocket means
# retaking every baseline that draws a converted image in the same commit.
#
# libvips42t64 brings libheif with its decoder plugins only; without the
# encoder plugin, heifsave fails and Manael answers with the original bytes,
# neither converted nor resized, as `infra/docker/server/Dockerfile` notes.
RUN printf '%s\n' \
      'Types: deb' \
      'URIs: http://archive.ubuntu.com/ubuntu' \
      'Suites: resolute' \
      'Components: main universe' \
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
      libvips42t64 \
      libheif-plugin-aomenc \
  && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/usr/local/bin/publira"]
