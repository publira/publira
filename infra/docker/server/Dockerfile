# syntax=docker/dockerfile:1.27@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

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

FROM golang:1.27-bookworm@sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195 AS builder

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

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libvips42 \
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
