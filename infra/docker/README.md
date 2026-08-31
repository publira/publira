# Dockerfile placement and build verification

This document defines where Dockerfiles for production and CI runtime images live, how to build them, and their connection to the `Docker / <target>` jobs. Follow it when adding services so the placement is unambiguous.

Implementation rules for agents: [`AGENTS.md`](./AGENTS.md) The full CI, including host CI (job layout, path filters, and triage): [`.github/workflows/README.md`](../../.github/workflows/README.md)

Related: [#82](https://github.com/publira/publira/issues/82) (policy and placement), [#83](https://github.com/publira/publira/issues/83) (placement conventions), and [#87](https://github.com/publira/publira/issues/87) (build verification and CI integration).

## Adopted policy

**Keep shared Dockerfiles grouped by runtime role under `infra/docker/<role>/`, and select the target with `ARG`.** The build context is always the **repository root** (`.`).

| Role | Path | Target | Primary ARGs |
| --- | --- | --- | --- |
| Web (Next.js) | [`web/Dockerfile`](./web/Dockerfile) | `apps/*` | `APP_NAME`, `PORT` |
| API (long-running) | [`api/Dockerfile`](./api/Dockerfile) | HTTP servers in `server/cmd/*` without CGO | `CMD_NAME`, `PORT` |
| Image (long-running) | [`image/Dockerfile`](./image/Dockerfile) | `image-server` / `admin-image-server` (Manael / libvips) | `CMD_NAME`, `PORT` |
| Batch | [`batch/Dockerfile`](./batch/Dockerfile) | `server/cmd/batch` (all batch jobs) | none |
| Node (long-running) | [`node/Dockerfile`](./node/Dockerfile) | non-Next.js services in `apps/*` | `APP_NAME`, `PORT` |

Keep the Dev Container separate from production images.

| Use | Path |
| --- | --- |
| Development environment | [`.devcontainer/Dockerfile`](../../.devcontainer/Dockerfile) |

Do **not** put Dockerfiles in `apps/*/Dockerfile` or `server/cmd/*/Dockerfile`, including generated copies.

## Why this layout

| Option | Decision | Reason |
| --- | --- | --- |
| Dockerfile under each service (the old policy) | Rejected | It duplicates the same image shape many times, making base-image digest and build-process updates inconsistent. |
| `infra/docker/templates/` copied to each command | Rejected | It creates two sources of truth—the template and generated output—which can drift. |
| **One Dockerfile per role plus `ARG`** (current) | **Adopted** | Each runtime has one file and only its build target changes. The root context handles the monorepo and `server/` correctly. |
| Combine Dev Container and production images | Rejected | Development tools (`task`, `sqlc`, Flutter, and more) have different responsibilities from a minimal runtime image. |

Role-based paths and links from this README and the root README retain the discoverability advantage of keeping a Dockerfile beside each service. Dockerfile header comments are the source of truth for implementation details such as `turbo prune` and Go `cmd` paths.

## Decision flow for new services

```text
What is being containerized?
├─ A Next.js app (apps/<name>)
│    → infra/docker/web/Dockerfile
│    → --build-arg APP_NAME=<name>   # package name is @publira/<name>
│    → Set PORT when needed (default: 3000)
│
├─ A long-running Go HTTP server (server/cmd/<name>, no CGO)
│    → infra/docker/api/Dockerfile
│    → --build-arg CMD_NAME=<name>
│    → Set PORT when needed (default: 8000)
│
├─ A Go image server (image-server / admin-image-server)
│    → infra/docker/image/Dockerfile
│    → --build-arg CMD_NAME=<name>
│    → Set PORT when needed (default: 8200)
│
├─ A Go batch job
│    → infra/docker/batch/Dockerfile (no build ARG)
│    → Select the job with a container argument: docker run publira/batch:local <subcommand>
│
├─ A long-running non-Next.js Node.js service (apps/<name>)
│    → infra/docker/node/Dockerfile
│    → --build-arg APP_NAME=<name>   # package name is @publira/<name>
│    → Set PORT when needed (default: 8080)
│
└─ Another runtime (for example, a worker in another language)
     → Add a new role at infra/docker/<role>/Dockerfile and update this table
     → Do not force it into an existing role
```

### Naming

- **Role directories** use a short category name (`web` / `api` / `batch` / `node`), never a service name.
- **`APP_NAME`** is the directory name directly under `apps/` (for example, `web-admin` or `email-renderer`). The Dockerfile adds the `@publira/` prefix.
- **`CMD_NAME`** is the directory name directly under `server/cmd/` (for example, `api-server`).
- **Example image tags** use `publira/<service-name>:local`, a build-time convention. Deployment defines registry policy separately.

## Build conventions

### Context and `-f`

```bash
# Always run this from the repository root.
docker build -f infra/docker/<role>/Dockerfile --build-arg ... -t publira/<name>:local .
```

- The context is the root (`.`); do not use `apps/web-admin` or `server` as the context.
- The root [`.dockerignore`](../../.dockerignore) narrows the context.

### Examples

```bash
# Web
docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-admin --build-arg PORT=4000 \
  -t publira/web-admin:local .

docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-host --build-arg PORT=3000 \
  -t publira/web-host:local .

docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-platform --build-arg PORT=4100 \
  -t publira/web-platform:local .

# API
docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=api-server --build-arg PORT=8000 \
  -t publira/api-server:local .

docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=admin-api-server --build-arg PORT=8001 \
  -t publira/admin-api-server:local .

docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=platform-api-server --build-arg PORT=8002 \
  -t publira/platform-api-server:local .

docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=outbox-worker --build-arg PORT=8003 \
  -t publira/outbox-worker:local .

# Image (Manael / libvips)
docker build -f infra/docker/image/Dockerfile \
  --build-arg CMD_NAME=image-server --build-arg PORT=8200 \
  -t publira/image-server:local .

docker build -f infra/docker/image/Dockerfile \
  --build-arg CMD_NAME=admin-image-server --build-arg PORT=8201 \
  -t publira/admin-image-server:local .

# Batch (all jobs share one image; choose the job with a container argument)
docker build -f infra/docker/batch/Dockerfile \
  -t publira/batch:local .

docker run --rm publira/batch:local publish-episodes

# Node
docker build -f infra/docker/node/Dockerfile \
  --build-arg APP_NAME=email-renderer --build-arg PORT=8080 \
  -t publira/email-renderer:local .
```

### Shared multi-stage policy

| Stage | Contents |
| --- | --- |
| Build | Debian-based image with the full toolchain (Node bookworm-slim / golang bookworm) |
| Runtime | distroless (Web / Node: `nodejs24-debian12:nonroot`; Go API / batch: `static:nonroot`). Image servers alone use `debian:bookworm-slim` plus `libvips42` (CGO). |
| Base image | Pin the digest as `tag@sha256:…` (tracked by Renovate). |
| Tool versions (`turbo`, `pnpm`, and more) | `ARG *_VERSION` plus `# renovate: datasource=…`, in the same form as [`.devcontainer/Dockerfile`](../../.devcontainer/Dockerfile) |

Web and Node use `turbo prune --docker` according to the [Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker) to reduce dependencies. Runtime images have no shell or `wget`, so **do not add a Docker `HEALTHCHECK`**. Have the orchestrator probe `/livez` (liveness) and `/readyz` (readiness).

The Node role has no equivalent of a Next.js standalone output, so the runner receives only the runtime dependency tree made by `pnpm install --prod` and each workspace package's `dist/`. Sources and development dependencies do not enter the runner. Anything imported at runtime must be in `dependencies`; entries only in `devDependencies` or unmet `peerDependencies` vanish from the `--prod` tree and cause startup failure.

### Main runtime environment variables (reference)

- Web: `PORT`, `HOSTNAME` (an image default is present), **`PUBLIRA_AUTH_SECRET` (required; at least 32 bytes; leaving it unset makes session-Cookie encryption and decryption throw)**, `PUBLIRA_REDIS_URL`, and `PUBLIRA_CACHE_APP` (defaults to `APP_NAME` at build time)
- API: **`PUBLIRA_AUTH_JWT_SECRET` (required; at least 32 bytes; without it, the server cannot start because it has no access-token signing key)**, app-specific values such as `PUBLIRA_*_DB_URL`. The binary configures its listener; `PORT` is `EXPOSE` and documentation metadata.
- Node: `PORT` (default: 8080) and `HOST` (image default: `0.0.0.0`). The email renderer has no external dependencies, so it requires no other variables.

See each service's README and Dockerfile comments for details.

## Exceptions

1. **Dev Container** (`.devcontainer/Dockerfile`) is not a production runtime image; it is for development with a toolchain and volumes.
2. **Temporary verification Dockerfiles** may exist only on a personal branch. To keep one on `main`, promote it to a new role under `infra/docker/` and update this table.
3. **Generated Dockerfiles must not be committed.** Do not copy a template into every service and commit the output.

## Responsibilities: Docker builds, local development, and CI

| Path | Purpose | Canonical command |
| --- | --- | --- |
| **Production image build** | Build and verify deployment images | `task docker:build:*` (runs `docker build -f infra/docker/...` with the root context) |
| **Local development** | Hot-reload development | Dev Container plus `task dev` / `task server:dev`, and so on (do not use production Dockerfiles) |
| **CI (images)** | Run `Docker / <target>` after detecting changes | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), using the same local `task docker:build:*` commands |

Production images and the Dev Container serve different purposes. A successful image build does not replace `task dev`, and the reverse is also true. For the complete CI picture, including host CI (`Check` / `Test / *` / `Build` / `Summary`), see [`.github/workflows/README.md`](../../.github/workflows/README.md).

## Local verification

Prerequisites: run from the repository root with Docker Engine and Buildx available.

### Representative images (routine verification)

The five primary build paths for Issues and CI are the following representatives, one for each role:

```bash
# All at once (web-host / api-server / batch / email-renderer / image-server)
task docker:verify

# Or individually
task docker:build:web APP_NAME=web-host PORT=3000
task docker:build:api CMD_NAME=api-server PORT=8000
task docker:build:batch
task docker:build:node APP_NAME=email-renderer PORT=8080
task docker:build:image CMD_NAME=image-server PORT=8200
```

Runtime smoke tests for distroless images without external dependencies:

```bash
task docker:smoke:web APP_NAME=web-host PORT=3000
task docker:smoke:node APP_NAME=email-renderer PORT=8080
```

`smoke:web` checks `/livez`; `smoke:node` checks the response bodies of both `/livez` and `/readyz`. API and batch runtime smoke tests need dependencies such as the database and object storage, so **a successful image build is their gate**. Check startup through the orchestrator or an integration environment.

### All images (before release or after large Dockerfile changes)

```bash
task docker:verify:full
```

This builds every target shown in the README examples in sequence.

### Raw `docker build` (for debugging)

Task is equivalent to the following command. You may run it directly rather than through Task while troubleshooting.

```bash
docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-host --build-arg PORT=3000 \
  -t publira/web-host:local .
```

## Docker CI execution strategy

This section covers only the `Docker / <target>` jobs. For path filters and execution strategy across all host CI jobs (`Check` / `Test / Go` / `Test / TypeScript` / `Test / DB Migrations` / `Test / Mobile` / `Test / Mobile E2E` / `Test / E2E` / `Build` / `Summary`), see [`.github/workflows/README.md`](../../.github/workflows/README.md).

### Comparison

| Strategy | Contents | Benefit | Drawback |
| --- | --- | --- | --- |
| **Build every image every time** | Every target on every PR | Least chance of missing a problem | High time and cost, especially Web × 3 |
| **Detect changes** | Build only the representative of affected roles | Fast PRs | May miss indirect effects outside the role |
| **Nightly full** | Build all targets periodically | Detects drift | Slow feedback |

### Adopted approach

Use **change detection (role representatives) plus nightly full builds**.

| Trigger | Mode | Build target |
| --- | --- | --- |
| `pull_request` / `push` (main) with related paths | **verify** | Representatives of changed roles only (table below) |
| Dockerfile, Taskfile, `.dockerignore`, or `ci.yml` changes | **full** | Every target documented here |
| `schedule` (daily at 03:00 UTC) | **full** | Every target (host CI is skipped) |
| `workflow_dispatch` | verify or full | Manual selection via the `docker_mode` input |

#### Role mapping for change detection

| Role | Representative target | Watched paths (summary) |
| --- | --- | --- |
| web | `web-host` | `apps/**`, `packages/**`, `locales/**`, lockfile / turbo, `infra/docker/web/**` |
| api | `api-server` | `server/**`, `infra/docker/api/**` |
| image | `image-server` | `server/**`, `infra/docker/image/**` |
| batch | `batch` | `server/**`, `infra/docker/batch/**` |
| node | `email-renderer` | `apps/email-renderer/**`, `packages/**`, `locales/**`, lockfile / turbo, `infra/docker/node/**` |

Changes under `server/**` build the api, batch, and image representatives because they share modules. `locales/**` is used by web and node because `@publira/i18n/catalog` and `@publira/email-templates` bundle repository-root message catalogs through relative imports.

Implementation: the `docker` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Job planning: [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh), which turns path-filter results into the Docker matrix. The local commands are the same: `task docker:build:web|api|image|batch|node` (Web then runs `task docker:smoke:web`, and Node then runs `task docker:smoke:node`).

Like other jobs, `Docker / <target>` can be skipped by its path filter. The only required check in the branch ruleset is the final aggregation job **`Summary`** (shown as `CI / Summary` in the UI); skipped intermediate jobs count as success.

## Build-failure triage

Use these steps when a `Docker / <target>` job or local `task docker:build:*` fails. For host-CI jobs (`Check` / `Test / *` / `Build`), see [the CI README's failure triage](../../.github/workflows/README.md#failure-triage).

1. **Identify the failing stage**
   - Image build: Dockerfile path, context, base image, or the build inside the container
   - Smoke only (`/livez` / `/readyz`): entrypoint path, `PORT`, or placement of standalone output or `dist/` (the image build succeeded)
2. **Reproduce with the same local Task**

   Run the `task docker:build:…` line from the CI log as-is.

   ```bash
   task docker:build:web APP_NAME=web-host PORT=3000
   # Or run all representatives.
   task docker:verify
   ```

3. **Narrow it down by layer**

   | Symptom | Likely cause |
   | --- | --- |
   | `ERROR: APP_NAME/CMD_NAME is required` | A missing build argument |
   | context / file not found | Running outside the root, or an overly broad `.dockerignore` exclusion |
   | `turbo prune` / `pnpm install` failure | Lockfile inconsistency, workspace name, or incorrect `APP_NAME` |
   | `pnpm turbo run build` failure | An application build error; first run `pnpm build --filter @publira/<app>` on the host |
   | `go build` failure | A `server/` compile error; first run `task server:build` |
   | Base pull failure / digest | Registry, digest update, or a missed Renovate PR |
   | Web smoke (`/livez`) only | Entrypoint path, `PORT`, or standalone output (the image build succeeded) |
   | Node smoke: `Cannot find package` | A runtime dependency is in `devDependencies` / `peerDependencies`, not `dependencies`, so `pnpm install --prod` omits it |
   | Web / Node cannot resolve `locales/*.json` | `turbo prune` does not include root `locales/`; explicitly `COPY` it in the builder stage |

4. **When only CI fails**
   - Runner architecture / Buildx differences from local (Go must not pin `TARGETOS` / `TARGETARCH` defaults)
   - A dirty cache: use `docker builder prune` locally or rerun CI
   - Concern about a missed path-filter match: run Docker `full` through `workflow_dispatch`, or inspect the nightly result
5. **After a fix**
   - Confirm the representative images with `task docker:verify` before updating the PR.
   - When adding a role, update this README's tables, [`Taskfile.yaml`](./Taskfile.yaml) `verify:full`, and the Docker full matrix in [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh) together.

## Change checklist

- [ ] For a new role, added `infra/docker/<role>/Dockerfile` and updated this README's table, decision flow, and build examples
- [ ] Pinned base-image digests and made tool-version `ARG`s trackable by Renovate
- [ ] Verified the build from the root with `docker build -f … .` and `task docker:build:*`
- [ ] Passed representative verification with `task docker:verify` (and `verify:full` when needed)
- [ ] For a new target, updated [`Taskfile.yaml`](./Taskfile.yaml) `verify:full` and the Docker full matrix in [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh)
- [ ] The documentation link from the root [README.md](../../README.md) reaches this file
