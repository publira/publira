# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Next.js monorepo image (turbo prune + standalone).
# Build on Debian (glibc); run on distroless — same split as api/publiractl.
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
# APP_NAME is the directory name under apps/ (e.g. web-admin, web-storefront, web-platform).
# Package name is derived as @publira/${APP_NAME}.

# -----------------------------------------------------------------------------
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS base

# renovate: datasource=npm depName=pnpm versioning=semver
ARG PNPM_VERSION=12.15.0

# pnpm comes from its standalone installer: the node images stop carrying
# Corepack from Node.js 26. The installer checks the npm registry signature over
# what it downloads only when openssl is present, and otherwise falls back to the
# checksum the registry itself publishes. `pnpm setup` cannot tell which shell
# config file to edit here, so PATH is set below instead.
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://get.pnpm.io/install.sh -o /tmp/pnpm-install.sh \
  && PNPM_VERSION="${PNPM_VERSION}" sh /tmp/pnpm-install.sh \
  && rm /tmp/pnpm-install.sh

WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS prepare

# renovate: datasource=npm depName=turbo versioning=semver
ARG TURBO_VERSION=2.11.10

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
# distroless publishes no versioned tags, so the image name carries the Node.js
# major and the Debian release, and the digest is the only further identifier.
# The Debian release matches the base stage: node_modules built there, and any
# native addon a dependency brings with it, run against this image's glibc.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS runner

ARG PORT=3000
# Re-declare for ENV (APP_NAME is only needed as cache namespace, not path)
ARG APP_NAME

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=${PORT}
# Redis cache key namespace of @publira/next-cache-handlers
ENV PNCH_CACHE_APP=${APP_NAME}

COPY --from=pack --chown=65532:65532 /pack ./

EXPOSE ${PORT}

# distroless has no shell/wget; configure HTTP probes in the orchestrator:
#   liveness  -> GET /livez
#   readiness -> GET /readyz
# Image entrypoint is /nodejs/bin/node; path is normalized to apps/web in the pack stage.
CMD ["apps/web/server.js"]
