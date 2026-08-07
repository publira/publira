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

FROM golang:1.26-bookworm@sha256:6c5605ab3a9a9fb3c4eafe5b3d63cdbf3881caf113262b67862547b54a9db599 AS builder

WORKDIR /src

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

ARG CMD_NAME
RUN test -n "${CMD_NAME}" || (echo "ERROR: CMD_NAME is required (e.g. publish-episodes)" >&2 && exit 1)

ARG TARGETOS=linux
ARG TARGETARCH=amd64

RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
  go build -trimpath -ldflags='-s -w' -o /out/job "./cmd/${CMD_NAME}"

FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6

WORKDIR /app

COPY --from=builder /out/job /app/job

USER nonroot

ENTRYPOINT ["/app/job"]
