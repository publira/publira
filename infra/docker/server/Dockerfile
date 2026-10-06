# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

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

FROM golang:1.27.1-trixie@sha256:3b77fc618ec235a1ab412de7737f120dd507c57e8d87de4cbb7994fb94275ed5 AS builder

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
FROM debian:13.7-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libvips42t64 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 65532 nonroot \
 && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin nonroot

WORKDIR /app

COPY --from=builder /out/publira /app/publira

# The binary configures its listeners (PUBLIRA_PUBLIC_API_ADDR and
# PUBLIRA_PUBLIC_API_GRPC_ADDR for `server`, PUBLIRA_WORKER_ADDR for
# `worker`); these are their defaults, as documentation metadata.
EXPOSE 8000 8100 8003

# debian-slim has no HEALTHCHECK convention here; orchestrator probes:
#   liveness  -> GET /livez
#   readiness -> GET /readyz

USER nonroot

ENTRYPOINT ["/app/publira"]
CMD ["server"]
