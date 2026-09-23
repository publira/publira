# syntax=docker/dockerfile:1.27@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Image for server/cmd/publiractl, the command that operates a Publira install.
# The command group and its subcommand are passed as container arguments:
# `db migrate` applies the db/migrations this image carries, and `job <kind>`
# runs one of the maintenance jobs, which the worker also schedules, so nothing
# runs this on a timer.
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/publiractl/Dockerfile \
#     -t publira/publiractl:local \
#     .
#
#   docker run --rm -e PUBLIRA_DB_URL publira/publiractl:local db migrate
#   docker run --rm publira/publiractl:local job purge-content-events

FROM golang:1.27-bookworm@sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195 AS builder

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
  -o /out/publiractl ./cmd/publiractl

FROM gcr.io/distroless/static:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3

WORKDIR /app

COPY --from=builder /out/publiractl /app/publiractl
# `db migrate` reads the migrations directory beside the binary, so the schema
# an image applies is the one it was built with.
COPY db/migrations/ /app/migrations/

USER nonroot

ENTRYPOINT ["/app/publiractl"]
