# syntax=docker/dockerfile:1.27@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Next.js monorepo image (turbo prune + standalone).
# Build on Debian (glibc); run on distroless — same split as api/batch.
# https://turborepo.dev/docs/guides/tools/docker
#
# Build from the repository root:
#
#   docker build \
#     -f infra/docker/web/Dockerfile \
#     --build-arg APP_NAME=web-admin \
#     --build-arg PORT=4000 \
#     -t publira/web-admin:local \
#     .
#
# APP_NAME is the directory name under apps/ (e.g. web-admin, web-host, web-platform).
# Package name is derived as @publira/${APP_NAME}.

# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base

# renovate: datasource=npm depName=pnpm versioning=semver
ARG PNPM_VERSION=11.25.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS prepare

# renovate: datasource=npm depName=turbo versioning=semver
ARG TURBO_VERSION=2.10.12

RUN npm install --global "turbo@${TURBO_VERSION}"

COPY . .

ARG APP_NAME
RUN test -n "${APP_NAME}" || (echo "ERROR: APP_NAME is required (e.g. web-admin)" >&2 && exit 1)

# Generate a partial monorepo with a pruned lockfile for the target workspace.
RUN turbo prune "@publira/${APP_NAME}" --docker

# -----------------------------------------------------------------------------
FROM base AS builder

ARG APP_NAME

# Install dependencies first (they change less often than source)
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Source files for the pruned workspace graph
COPY --from=prepare /app/out/full/ .

# The message catalogs live at the repository root, outside the pnpm workspace, so
# `turbo prune` leaves them behind. @publira/i18n/catalog imports them relatively
# and bundles them at build time.
COPY --from=prepare /app/locales ./locales

# Some apps do not ship a public/ directory; standalone COPY still expects it.
RUN mkdir -p "apps/${APP_NAME}/public"

# Optional: enable Turborepo Remote Cache during the image build
# ARG TURBO_TEAM
# ENV TURBO_TEAM=$TURBO_TEAM
# ARG TURBO_TOKEN
# ENV TURBO_TOKEN=$TURBO_TOKEN

RUN pnpm turbo run build --filter="@publira/${APP_NAME}"

# -----------------------------------------------------------------------------
# Normalize layout so the distroless CMD can be a fixed path (no shell / no ARG in CMD).
FROM base AS pack

ARG APP_NAME

WORKDIR /pack

COPY --from=builder /app/apps/${APP_NAME}/.next/standalone ./
COPY --from=builder /app/apps/${APP_NAME}/.next/static ./apps/${APP_NAME}/.next/static
COPY --from=builder /app/apps/${APP_NAME}/public ./apps/${APP_NAME}/public

# Always expose the app as apps/web for a stable entrypoint under distroless.
RUN if [ "${APP_NAME}" != "web" ]; then mv "apps/${APP_NAME}" apps/web; fi

# -----------------------------------------------------------------------------
# nonroot uid/gid 65532 (matches gcr.io/distroless/*:nonroot)
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS runner

ARG PORT=3000
# Re-declare for ENV (APP_NAME is only needed as cache namespace, not path)
ARG APP_NAME

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=${PORT}
# Redis cache key namespace (see packages/next-cache-handlers)
ENV PUBLIRA_CACHE_APP=${APP_NAME}

COPY --from=pack --chown=65532:65532 /pack ./

EXPOSE ${PORT}

# distroless has no shell/wget; configure HTTP probes in the orchestrator:
#   liveness  -> GET /livez
#   readiness -> GET /readyz
# Image entrypoint is /nodejs/bin/node; path is normalized to apps/web in the pack stage.
CMD ["apps/web/server.js"]
