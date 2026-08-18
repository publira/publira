# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# Node.js ConnectRPC service image (turbo prune + pnpm production install).
# Build on Debian (glibc); run on distroless — same split as web/api/batch.
# https://turborepo.dev/docs/guides/tools/docker
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/email-renderer/Dockerfile \
#     --build-arg PORT=8080 \
#     -t publira/email-renderer:local \
#     .
#
# The target workspace is @publira/email-renderer (apps/email-renderer). Unlike the
# web role there is no APP_NAME: this role builds a single service, and another
# Node.js service would get its own role directory.

# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS base

# renovate: datasource=npm depName=pnpm versioning=semver
ARG PNPM_VERSION=11.21.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS prepare

# renovate: datasource=npm depName=turbo versioning=semver
ARG TURBO_VERSION=2.10.10

RUN npm install --global "turbo@${TURBO_VERSION}"

COPY . .

# Generate a partial monorepo with a pruned lockfile for the target workspace.
RUN turbo prune "@publira/email-renderer" --docker

# -----------------------------------------------------------------------------
# Runtime dependency tree. Installed from the manifests alone, so the layer is
# reused whenever only source changes, and dev-only packages never reach the runner.
FROM base AS deps

COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod

# -----------------------------------------------------------------------------
FROM base AS builder

# Install dependencies first (they change less often than source)
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Source files for the pruned workspace graph
COPY --from=prepare /app/out/full/ .

# The message catalogs live at the repository root, outside the pnpm workspace, so
# `turbo prune` leaves them behind. @publira/email-templates imports them relatively
# and bundles them into its dist, which is why they are only needed at build time.
COPY --from=prepare /app/locales ./locales

RUN pnpm turbo run build --filter="@publira/email-renderer"

# Collect the compiled output of every workspace package in the pruned graph, so
# the runner gets each dist/ without the sources that produced it.
RUN set -eux; \
  find apps packages -mindepth 2 -maxdepth 2 -type d -name dist \
    -exec sh -c 'mkdir -p "/pack/$(dirname "$1")" && cp -a "$1" "/pack/$1"' _ {} \;

# -----------------------------------------------------------------------------
# nonroot uid/gid 65532 (matches gcr.io/distroless/*:nonroot)
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS runner

ARG PORT=8080

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=${PORT}

COPY --from=deps --chown=65532:65532 /app/ ./
COPY --from=builder --chown=65532:65532 /pack/ ./

EXPOSE ${PORT}

# distroless has no shell/wget; configure HTTP probes in the orchestrator:
#   liveness  -> GET /livez
#   readiness -> GET /readyz
# Image entrypoint is /nodejs/bin/node.
CMD ["apps/email-renderer/dist/index.mjs"]
