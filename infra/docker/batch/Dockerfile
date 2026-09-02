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
#   docker run --rm publira/batch:local publish-episodes

FROM golang:1.27-bookworm@sha256:648f440f42a0958804efb24df176f806f9d353b41f1c0627f666428e40310f6b AS builder

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

FROM gcr.io/distroless/static:nonroot@sha256:1c2c046bc09ed40fad370b599a0b1ae7987f55b01e247cf27a7c27cd97e5bbc7

WORKDIR /app

COPY --from=builder /out/job /app/job

USER nonroot

ENTRYPOINT ["/app/job"]
