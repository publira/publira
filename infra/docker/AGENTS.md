# Infra Docker Agent Guide

Conventions for production container images under `infra/docker/`. Prefer this file for Docker image work; root [AGENTS.md](../../AGENTS.md) remains the top-level source of truth for repo-wide agent policy.

Human-facing placement rationale and full decision tables: [`README.md`](./README.md).

## Layout

| Path | Role |
| --- | --- |
| `web/Dockerfile` | Next.js apps (`apps/*`) via `turbo prune` + standalone |
| `api/Dockerfile` | Long-running Go HTTP servers (`server/cmd/*`) |
| `batch/Dockerfile` | One-shot Go jobs (`server/cmd/*`) |
| `README.md` | Placement rules, build verification, Docker CI job, build triage (source of truth for humans) |
| `Taskfile.yaml` | Canonical `task docker:build:*` / `verify` / `smoke:web` (included from repo root) |

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

4. **No Docker `HEALTHCHECK`** on distroless runners (no shell/wget). Orchestrator probes for API / image-server / Web:
   - liveness `GET /livez`
   - readiness `GET /readyz`
5. **Web**: follow [Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker) (`turbo prune --docker`). Keep standalone path stable for distroless `CMD` (pack stage may normalize to `apps/web`).
6. **Go**: `CGO_ENABLED=0`. Redeclare `ARG TARGETOS` / `ARG TARGETARCH` **without defaults** so BuildKit’s automatic platform values apply (defaults would pin amd64 even under `--platform linux/arm64`).
7. Keep root [`.dockerignore`](../../.dockerignore) in mind; do not rely on shipping `node_modules` / `.next` from the host.

## Verification after Dockerfile changes

From the **repository root**, prefer Task (same entrypoint as CI):

```bash
# Role representatives (web-host / api-server / publish-episodes)
task docker:verify

# Or only what you touched
task docker:build:web APP_NAME=web-admin PORT=4000
task docker:build:api CMD_NAME=api-server PORT=8000
task docker:build:batch CMD_NAME=publish-episodes

# Optional web runtime smoke
task docker:smoke:web APP_NAME=web-host PORT=3000
```

Raw `docker build -f infra/docker/<role>/Dockerfile … .` is fine for debugging; keep context at repo root.

After adding a service/target: update `README.md` examples, `Taskfile.yaml` `verify:full`, and the Docker full matrix in [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh) together.

Docker CI strategy and build triage: [`README.md`](./README.md)（Docker の CI 実行戦略 / ビルド失敗時のトリアージ節）.  
Host CI as a whole (jobs, path filters, triage): [`.github/workflows/README.md`](../../.github/workflows/README.md).  
Branch ruleset required check is the final aggregator job name **`Summary`** only (UI: `CI / Summary`).

## Do not

- Commit generated per-service Dockerfiles “from templates”.
- Use Alpine for Next.js **build** when the runner is Debian-based distroless (glibc / native addons such as `sharp`).
- Put production image logic into `.devcontainer/Dockerfile`.
