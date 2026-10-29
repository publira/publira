# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Image for server/cmd/publiractl, the command that operates a Publira install.
# The command group and its subcommand are passed as container arguments:
# `db migrate` applies the db/migrations this image carries, `db roles` creates
# the login roles from the db/seeds/baseline it carries, and `job <kind>`
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

FROM golang:1.27.3-trixie@sha256:c65ecfe613b539ac74c62a4c3b2c27e8f8a6076384c8f27e8a3c0f3be17cc385 AS builder

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

# Named by its Debian release rather than the unsuffixed `static` alias, so a
# new Debian release cannot change the runtime under an unchanged tag.
# distroless publishes no versioned tags, so the digest is the only further
# identifier.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:18f4cc26c9ffa7f20a359298be7deadac5c607c8e03a02b8119f1a5fc2f82c99

WORKDIR /app

COPY --from=builder /out/publiractl /app/publiractl
# `db migrate` reads the migrations directory beside the binary, so the schema
# an image applies is the one it was built with.
COPY db/migrations/ /app/migrations/
# `db roles` reads the roles directory beside the binary the same way, and
# `task db:seed ENV=prod` applies the same files through psql.
COPY db/seeds/baseline/ /app/roles/

USER nonroot

ENTRYPOINT ["/app/publiractl"]
