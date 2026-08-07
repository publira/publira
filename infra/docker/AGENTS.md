# Infra Docker Agent Guide

Conventions for production container images under `infra/docker/`. Prefer this file for Docker image work; root [AGENTS.md](../../AGENTS.md) remains the top-level source of truth for repo-wide agent policy.

Human-facing placement rationale and full decision tables: [`README.md`](./README.md).

## Layout

| Path | Role |
| --- | --- |
| `web/Dockerfile` | Next.js apps (`apps/*`) via `turbo prune` + standalone |
| `api/Dockerfile` | Long-running Go HTTP servers (`server/cmd/*`) |
| `batch/Dockerfile` | One-shot Go jobs (`server/cmd/*`) |
| `README.md` | Placement rules, rationale, build examples (source of truth for _where_) |

Dev Container is **out of scope** here: [`.devcontainer/Dockerfile`](../../.devcontainer/Dockerfile).

## Placement rules

1. **One Dockerfile per runtime role**, not per service. Switch target with build `ARG`s.
2. **Build context is always the repository root** (`.`). Use  
   `docker build -f infra/docker/<role>/Dockerfile ... .`
3. **Do not** add `apps/*/Dockerfile` or `server/cmd/*/Dockerfile`.
4. **Do not** reintroduce template → copy expansion under service directories.
5. New runtime family (not web/api/batch) → add `infra/docker/<role>/Dockerfile` and update `README.md`.

### ARG map

| Role | Required ARG | Optional | Resolves to |
| --- | --- | --- | --- |
| `web` | `APP_NAME` (e.g. `web-admin`) | `PORT` (default `3000`) | package `@publira/${APP_NAME}`, path `apps/${APP_NAME}` |
| `api` | `CMD_NAME` (e.g. `api-server`) | `PORT` (default `8000`) | `server/cmd/${CMD_NAME}` → binary `/app/server` |
| `batch` | `CMD_NAME` (e.g. `publish-episodes`) | — | `server/cmd/${CMD_NAME}` → binary `/app/job` |

## Implementation rules

1. **Multi-stage**: build on Debian toolchain images; run on **distroless `nonroot`**.
   - Web: `node:*-bookworm-slim` → `gcr.io/distroless/nodejs*-debian12:nonroot`
   - Go: `golang:*-bookworm` → `gcr.io/distroless/static:nonroot`
2. **Pin base images by digest** (`image:tag@sha256:…`). Match existing files and Renovate Docker updates.
3. **Tool versions** (`pnpm`, `turbo`, …) as `ARG *_VERSION` with a Renovate comment, same style as `.devcontainer/Dockerfile`:

   ```dockerfile
   # renovate: datasource=npm depName=turbo versioning=semver
   ARG TURBO_VERSION=2.10.8
   ```

4. **No Docker `HEALTHCHECK`** on distroless runners (no shell/wget). Document `/healthz` for orchestrator probes.
5. **Web**: follow [Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker) (`turbo prune --docker`). Keep standalone path stable for distroless `CMD` (pack stage may normalize to `apps/web`).
6. **Go**: `CGO_ENABLED=0`; honor `TARGETOS` / `TARGETARCH` when present.
7. Keep root [`.dockerignore`](../../.dockerignore) in mind; do not rely on shipping `node_modules` / `.next` from the host.

## Verification after Dockerfile changes

From the **repository root**:

```bash
# Web (example)
docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-admin --build-arg PORT=4000 \
  -t publira/web-admin:local .

# API (example)
docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=api-server --build-arg PORT=8000 \
  -t publira/api-server:local .

# Batch (example)
docker build -f infra/docker/batch/Dockerfile \
  --build-arg CMD_NAME=publish-episodes \
  -t publira/publish-episodes:local .
```

Smoke-check at least one image that you touched (e.g. web: `curl` `/healthz` with `REDIS_URL=disabled` if needed).

## Do not

- Commit generated per-service Dockerfiles “from templates”.
- Use Alpine for Next.js **build** when the runner is Debian-based distroless (glibc / native addons such as `sharp`).
- Put production image logic into `.devcontainer/Dockerfile`.
