# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# The image of server/cmd/publira, the binary behind both long-lived Go
# processes. The container argument names the process: `server` (the default)
# answers the API and image delivery, `worker` drains the Outbox and runs
# every scheduled job. One image for both, because they are one binary.
#
# Manael (libvips / CGO) is linked in for image delivery, so the runtime is
# debian-slim with libvips rather than distroless/static, and the worker
# carries the library too. CGO cannot be cross-compiled without a matching
# toolchain, so this Dockerfile does not set GOOS/GOARCH: Buildx --platform
# must match the builder (native per-arch builds).
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/server/Dockerfile \
#     -t publira/publira:local \
#     .
#
#   docker run --rm publira/publira:local          # publira server
#   docker run --rm publira/publira:local worker   # publira worker

FROM golang:1.27.3-trixie@sha256:af1bfc2614ebb1dbd31af514b78740fd678850e76498762b425ecee4c5c6ea80 AS builder

# libvips is built from its release rather than taken from Debian, because
# Debian's libvips42t64 is built with every loader libvips has and depends on
# the library behind each: OpenEXR, ImageMagick, librsvg and libxml2, Poppler,
# OpenSlide, and more. bimg hands libvips the bytes of a stored object and lets
# it pick the loader from them, so each of those libraries parses whatever an
# upload carried. The originals it is handed are JPEG, PNG, GIF, and WebP, and
# it writes WebP and AVIF, so libvips is built with those formats alone; an
# object in any other format fails to load and Manael answers with it as
# stored. libexif applies the orientation a photo records, lcms2 converts its
# colour profile, and highway is libvips' SIMD backend. The tarball is checked
# against the checksum the release publishes beside it.
# renovate: datasource=github-releases depName=libvips/libvips versioning=semver-coerced
ARG LIBVIPS_VERSION=8.18.7

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      meson ninja-build pkg-config xz-utils \
      libexif-dev libexpat1-dev libglib2.0-dev libheif-dev libhwy-dev \
      libjpeg62-turbo-dev liblcms2-dev libspng-dev libwebp-dev \
 && rm -rf /var/lib/apt/lists/*

RUN cd /tmp \
 && url="https://github.com/libvips/libvips/releases/download/v${LIBVIPS_VERSION}/vips-${LIBVIPS_VERSION}.tar.xz" \
 && curl -fsSL --retry 5 -O "${url}" \
 && curl -fsSL --retry 5 -O "${url}.sha256sum" \
 && sha256sum -c "vips-${LIBVIPS_VERSION}.tar.xz.sha256sum" \
 && mkdir /tmp/vips \
 && tar -xJf "vips-${LIBVIPS_VERSION}.tar.xz" -C /tmp/vips --strip-components=1 \
 && meson setup /tmp/vips/build /tmp/vips \
      --prefix=/usr/local --libdir=lib --buildtype=release \
      --auto-features=disabled \
      -Dmodules=disabled -Dexamples=false -Dcplusplus=false \
      -Djpeg=enabled -Dspng=enabled -Dnsgif=true -Dwebp=enabled -Dheif=enabled \
      -Dexif=enabled -Dlcms=enabled -Dhighway=enabled \
      -Dppm=false -Danalyze=false -Dradiance=false \
 && meson install -C /tmp/vips/build \
 && mkdir -p /out/lib \
 && cp -a /usr/local/lib/libvips.so.42* /out/lib/ \
 && rm -rf /tmp/vips /tmp/vips-*

WORKDIR /src

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

# The build context carries no .git, so Go cannot stamp VCS information by
# itself and telemetry would report every image as "dev". VERSION is passed
# in and linked into internal/buildinfo instead.
ARG VERSION=dev

RUN CGO_ENABLED=1 go build -trimpath \
  -ldflags="-s -w -X github.com/publira/publira/server/internal/buildinfo.version=${VERSION}" \
  -o /out/publira ./cmd/publira

# The Debian release matches the builder's, because the libvips the builder
# compiled is linked against its libraries. The packages are the runtime
# libraries of the -dev packages the builder installs, and nothing else.
#
# libheif1 brings its decoder plugins only, and image delivery converts a JPEG
# to AVIF for every browser that accepts it: without an encoder plugin,
# heifsave fails and Manael answers with the original bytes, neither converted
# nor resized.
FROM debian:13.7-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

COPY --from=builder /out/lib/ /usr/local/lib/

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libexif12 libexpat1 libglib2.0-0t64 libheif1 libheif-plugin-aomenc libhwy1t64 \
      libjpeg62-turbo liblcms2-2 libspng0 libwebp7 libwebpdemux2 libwebpmux3 \
 && rm -rf /var/lib/apt/lists/* \
 && ldconfig \
 && groupadd --gid 65532 nonroot \
 && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin nonroot

WORKDIR /app

COPY --from=builder /out/publira /app/publira

# The binary configures its listeners (PUBLIRA_PUBLIC_API_ADDR for `server`,
# PUBLIRA_WORKER_ADDR for `worker`); these are their defaults, as
# documentation metadata.
EXPOSE 8000 8003

# debian-slim has no HEALTHCHECK convention here; orchestrator probes:
#   liveness  -> GET /livez
#   readiness -> GET /readyz

USER nonroot

ENTRYPOINT ["/app/publira"]
CMD ["server"]
