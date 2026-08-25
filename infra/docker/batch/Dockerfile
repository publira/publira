# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# Batch / one-shot job image for server/cmd/* entrypoints.
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/batch/Dockerfile \
#     --build-arg CMD_NAME=publish-episodes \
#     -t publira/publish-episodes:local \
#     .

FROM golang:1.27-bookworm@sha256:4cdeb0986daca9cfb8b0485f762778a149206025d80ae4212fde9a8dacedca55 AS builder

WORKDIR /src

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

ARG CMD_NAME
RUN test -n "${CMD_NAME}" || (echo "ERROR: CMD_NAME is required (e.g. publish-episodes)" >&2 && exit 1)

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
  -o /out/job "./cmd/${CMD_NAME}"

FROM gcr.io/distroless/static:nonroot@sha256:1c2c046bc09ed40fad370b599a0b1ae7987f55b01e247cf27a7c27cd97e5bbc7

WORKDIR /app

COPY --from=builder /out/job /app/job

USER nonroot

ENTRYPOINT ["/app/job"]
