# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Long-running Node.js service image for apps/* that are not Next.js
# (turbo prune + pnpm production install).
# Build on Debian (glibc); run on distroless — same split as web/api/publiractl.
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
FROM node:24.22.1-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a AS base

# renovate: datasource=npm depName=pnpm versioning=semver
ARG PNPM_VERSION=12.15.0

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}/bin:${PATH}"

# openssl lets the pnpm installer verify the npm registry signature.
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
RUN test -n "${APP_NAME}" || (echo "ERROR: APP_NAME is required (e.g. email-renderer)" >&2 && exit 1)

# Generate a partial monorepo with a pruned lockfile for the target workspace.
RUN turbo prune "@publira/${APP_NAME}" --docker

# -----------------------------------------------------------------------------
# Runtime dependency tree. Installed from the manifests alone, so the layer is
# reused whenever only source changes, and dev-only packages never reach the runner.
#
# There is no standalone output to fall back on here, the way the Next.js role
# has one: the runner gets this tree plus each workspace package's dist/, and
# nothing else. Anything the compiled output imports at runtime therefore has
# to sit in a `dependencies` field — a devDependencies entry, or an unmet
# peerDependency, disappears under --prod and the container dies on
# `Cannot find package`.
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
# distroless publishes no versioned tags, so the image name carries the Node.js
# major and the Debian release, and the digest is the only further identifier.
# The Debian release matches the base stage: node_modules built there, and any
# native addon a dependency brings with it, run against this image's glibc.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS runner

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
# A Compose healthcheck runs node itself instead:
#   /nodejs/bin/node -e "fetch('http://127.0.0.1:<PORT>/readyz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Image entrypoint is /nodejs/bin/node; path is normalized to apps/node in the pack stage.
CMD ["apps/node/dist/index.mjs"]
