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

FROM golang:1.27.3-trixie@sha256:f0778846091f55d452c0aafb693f919e79bfa349d59dc5664d5ccd8924af6d17 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends libvips-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

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

# The Debian release matches the builder's, because the binary is linked
# against the libvips the builder installed. Debian 13's 64-bit time_t
# transition renamed the runtime package to libvips42t64.
#
# libvips42t64 brings libheif with its decoder plugins only, and image delivery
# converts a JPEG to AVIF for every browser that accepts it: without an encoder
# plugin, heifsave fails and Manael answers with the original bytes, neither
# converted nor resized.
FROM debian:13.7-slim@sha256:89c1ea91e897f0fe0a3731595330bc45b8bdef4047464a07116f891a94054b31

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libvips42t64 libheif-plugin-aomenc \
 && rm -rf /var/lib/apt/lists/* \
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
