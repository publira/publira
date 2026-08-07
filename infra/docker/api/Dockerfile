# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# API server image for long-running server/cmd/* entrypoints.
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/api/Dockerfile \
#     --build-arg CMD_NAME=api-server \
#     --build-arg PORT=8000 \
#     -t publira/api-server:local \
#     .
#
# Examples:
#   CMD_NAME=api-server          PORT=8000
#   CMD_NAME=admin-api-server    PORT=8001
#   CMD_NAME=platform-api-server PORT=8002

FROM golang:1.26-bookworm@sha256:6c5605ab3a9a9fb3c4eafe5b3d63cdbf3881caf113262b67862547b54a9db599 AS builder

WORKDIR /src

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

ARG CMD_NAME
RUN test -n "${CMD_NAME}" || (echo "ERROR: CMD_NAME is required (e.g. api-server)" >&2 && exit 1)

# Inherit BuildKit automatic platform ARGs (do not set defaults — they override --platform).
ARG TARGETOS
ARG TARGETARCH

RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
  go build -trimpath -ldflags='-s -w' -o /out/server "./cmd/${CMD_NAME}"

FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6

ARG PORT=8000

ENV APP_PORT=${PORT}
ENV HEALTHCHECK_PORT=${PORT}

WORKDIR /app

COPY --from=builder /out/server /app/server

EXPOSE ${PORT}

# distroless/static has no shell or wget; configure HTTP probes to /healthz
# in the orchestrator (K8s liveness/readiness) instead of Docker HEALTHCHECK.

USER nonroot

ENTRYPOINT ["/app/server"]
