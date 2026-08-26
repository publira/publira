# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# Long-running Node.js service image for apps/* that are not Next.js
# (turbo prune + pnpm production install).
# Build on Debian (glibc); run on distroless — same split as web/api/batch.
# https://turborepo.dev/docs/guides/tools/docker
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/node/Dockerfile \
#     --build-arg APP_NAME=email-renderer \
#     --build-arg PORT=8080 \
#     -t publira/email-renderer:local \
#     .
#
# APP_NAME is the directory name under apps/ (e.g. email-renderer).
# Package name is derived as @publira/${APP_NAME}, and the entrypoint is its
# dist/index.mjs. Next.js apps use infra/docker/web/Dockerfile instead.

# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS base

# renovate: datasource=npm depName=pnpm versioning=semver
ARG PNPM_VERSION=11.23.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS prepare

# renovate: datasource=npm depName=turbo versioning=semver
ARG TURBO_VERSION=2.10.11

RUN npm install --global "turbo@${TURBO_VERSION}"

COPY . .

ARG APP_NAME
RUN test -n "${APP_NAME}" || (echo "ERROR: APP_NAME is required (e.g. email-renderer)" >&2 && exit 1)

# Generate a partial monorepo with a pruned lockfile for the target workspace.
RUN turbo prune "@publira/${APP_NAME}" --docker

# -----------------------------------------------------------------------------
# Runtime dependency tree. Installed from the manifests alone, so the layer is
# reused whenever only source changes, and dev-only packages never reach the runner.
FROM base AS deps

COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod

# -----------------------------------------------------------------------------
FROM base AS builder

ARG APP_NAME

# Install dependencies first (they change less often than source)
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Source files for the pruned workspace graph
COPY --from=prepare /app/out/full/ .

# The message catalogs live at the repository root, outside the pnpm workspace, so
# `turbo prune` leaves them behind. @publira/email-templates and @publira/i18n/catalog
# import them relatively and bundle them into dist, which is why they are only
# needed at build time.
COPY --from=prepare /app/locales ./locales

RUN pnpm turbo run build --filter="@publira/${APP_NAME}"

# Collect the compiled output of every workspace package in the pruned graph, so
# the runner gets each dist/ without the sources that produced it.
RUN set -eux; \
  find apps packages -mindepth 2 -maxdepth 2 -type d -name dist \
    -exec sh -c 'mkdir -p "/dist/$(dirname "$1")" && cp -a "$1" "/dist/$1"' _ {} \;

# -----------------------------------------------------------------------------
# Normalize layout so the distroless CMD can be a fixed path (no shell / no ARG in CMD).
FROM base AS pack

ARG APP_NAME

WORKDIR /pack

COPY --from=deps /app/ ./
COPY --from=builder /dist/ ./

# Always expose the app as apps/node for a stable entrypoint under distroless.
# The depth stays the same, so the relative symlinks pnpm created still resolve.
RUN if [ "${APP_NAME}" != "node" ]; then mv "apps/${APP_NAME}" apps/node; fi

# -----------------------------------------------------------------------------
# nonroot uid/gid 65532 (matches gcr.io/distroless/*:nonroot)
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS runner

ARG PORT=8080

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=${PORT}

COPY --from=pack --chown=65532:65532 /pack ./

EXPOSE ${PORT}

# distroless has no shell/wget; configure HTTP probes in the orchestrator:
#   liveness  -> GET /livez
#   readiness -> GET /readyz
# Image entrypoint is /nodejs/bin/node; path is normalized to apps/node in the pack stage.
CMD ["apps/node/dist/index.mjs"]
