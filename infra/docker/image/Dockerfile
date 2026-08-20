# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# Image-server image. Manael (libvips / CGO) is linked in, so this is a
# separate runtime family from infra/docker/api (CGO_ENABLED=0, distroless/static).
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/image/Dockerfile \
#     --build-arg CMD_NAME=image-server \
#     --build-arg PORT=8200 \
#     -t publira/image-server:local \
#     .
#
# Examples:
#   CMD_NAME=image-server        PORT=8200
#   CMD_NAME=admin-image-server  PORT=8201
#
# CGO cannot be cross-compiled without a matching toolchain, so this
# Dockerfile does not set GOOS/GOARCH. Buildx --platform must match the
# builder (native per-arch builds).

FROM golang:1.27-bookworm@sha256:484ef6066fa69acb059fdfeda7ba2b8f7391f2ef6abc6f9b8411e669ebd56466 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends libvips-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

ARG CMD_NAME
RUN test -n "${CMD_NAME}" || (echo "ERROR: CMD_NAME is required (e.g. image-server)" >&2 && exit 1)

RUN CGO_ENABLED=1 go build -trimpath -ldflags='-s -w' -o /out/server "./cmd/${CMD_NAME}"

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libvips42 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 65532 nonroot \
 && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin nonroot

ARG PORT=8200

ENV APP_PORT=${PORT}
ENV HEALTHCHECK_PORT=${PORT}

WORKDIR /app

COPY --from=builder /out/server /app/server

EXPOSE ${PORT}

# debian-slim has no HEALTHCHECK convention here; orchestrator probes:
#   liveness  -> GET /livez
#   readiness -> GET /readyz

USER nonroot

ENTRYPOINT ["/app/server"]
