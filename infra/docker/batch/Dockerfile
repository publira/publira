# syntax=docker/dockerfile:1.27@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Batch job image for server/cmd/batch. Every batch ships in this one image;
# the subcommand passed as a container argument selects the job to run.
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/batch/Dockerfile \
#     -t publira/batch:local \
#     .
#
#   docker run --rm publira/batch:local purge-content-events

FROM golang:1.27-bookworm@sha256:74138d243a7968b954d70ab90c0927a4e87e814ffd554152e8b50b9973505c23 AS builder

WORKDIR /src

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

# Inherit BuildKit automatic platform ARGs (do not set defaults — they override --platform).
ARG TARGETOS
ARG TARGETARCH

# The build context carries no .git, so Go cannot stamp VCS information by
# itself and telemetry would report every image as "dev". VERSION is passed
# in and linked into internal/buildinfo instead.
ARG VERSION=dev

RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
  go build -trimpath \
  -ldflags="-s -w -X github.com/publira/publira/server/internal/buildinfo.version=${VERSION}" \
  -o /out/job ./cmd/batch

FROM gcr.io/distroless/static:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3

WORKDIR /app

COPY --from=builder /out/job /app/job

USER nonroot

ENTRYPOINT ["/app/job"]
