# Container images

Reference for the container images built from `infra/docker/`: which Dockerfile builds what, how to build and verify them, the `Docker / <target>` jobs that build them in CI, and what to do when a build fails. The conventions a change here follows — which image a new service goes into, how a Dockerfile is written, and what a new target is registered in — are in [`AGENTS.md`](./AGENTS.md). The full CI, including host CI (job layout, path filters, and triage): [`.github/workflows/README.md`](../../.github/workflows/README.md)

## Layout

Each Dockerfile builds one runtime role, and build `ARG`s select the target. The build context is always the **repository root** (`.`).

| Path | Builds | Build ARGs |
| --- | --- | --- |
| [`web/Dockerfile`](./web/Dockerfile) | Next.js apps in `apps/*`, through `turbo prune` and standalone output: package `@publira/${APP_NAME}`, path `apps/${APP_NAME}` | `APP_NAME` (for example, `web-admin`); `PORT` (default: `3000`) |
| [`server/Dockerfile`](./server/Dockerfile) | `server/cmd/publira` as `/app/publira`, the binary behind `publira server` (the API and image delivery, linking Manael / libvips) and `publira worker`; the container argument picks the process (`server`, the default, or `worker`) | `VERSION` (optional) |
| [`publiractl/Dockerfile`](./publiractl/Dockerfile) | `server/cmd/publiractl` as `/app/publiractl`, the command that operates an install: `db migrate` over the `db/migrations` it carries, `db roles` over the `db/seeds/baseline` it carries, `db reseal`, which seals every stored secret again with the primary encryption key, every maintenance job an operator runs by hand (the worker schedules them as well), the `policy` and `retention` commands that change the platform policy and the retention defaults, the `smtp` commands that save and test the platform's SMTP settings, the `storage` commands that save and test the platform's object store, the `tenant` commands that create and manage a tenant, and the `webpush` commands that turn on Web Push; the command is the container arguments (`db migrate`, `db roles`, `job <kind>`) | none |
| [`node/Dockerfile`](./node/Dockerfile) | Long-running Node.js services in `apps/*` that are not Next.js: package `@publira/${APP_NAME}`, path `apps/${APP_NAME}`, entry `dist/index.mjs` | `APP_NAME` (for example, `email-renderer`); `PORT` (default: `8080`) |
| [`opensearch/Dockerfile`](./opensearch/Dockerfile) | OpenSearch with the `analysis-kuromoji`, `analysis-icu`, `analysis-nori`, and `analysis-smartcn` plugins, run by the `search` profile of the root `compose.yaml` and of `e2e/compose.yaml`, and by the Go integration tests | none |
| [`elasticsearch/Dockerfile`](./elasticsearch/Dockerfile) | Elasticsearch as its official image ships it, with no plugin, run by the Go integration tests | none |
| [`Taskfile.yaml`](./Taskfile.yaml) | The `task docker:build:*`, `docker:verify`, `docker:verify:full`, and `docker:smoke:*` tasks, included from the root Taskfile | — |

A deployment runs the long-running images and nothing on a timer: the worker (the server image with `worker` as its container argument) schedules every recurring job, the maintenance jobs included. The publiractl image is what a deployment runs once per release to apply the migrations and the role grants it carries (`db migrate`, then `db roles`), and what an operator runs one of those jobs with by hand — a backfill of a named date, a recovery, a dry-run purge — so it is not something a deployment has to schedule.

The OpenSearch and Elasticsearch images are not deployment images: a deployment brings its own engine, which needs no plugin for the default text analysis. The OpenSearch image is built by `docker compose --profile search` and by the `Test / E2E Search` job, and both are built by the `search` share of the `Test / Go` job and, when it is not handed one, by the Go integration tests themselves (`PUBLIRA_TEST_OPENSEARCH_IMAGE` and `PUBLIRA_TEST_ELASTICSEARCH_IMAGE` in [`server/README.md`](../../server/README.md#tests)). Neither has a `task docker:build:*` target or a row in the Docker matrix.

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
  --build-arg APP_NAME=web-storefront --build-arg PORT=3000 \
  -t publira/web-storefront:local .

docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-platform --build-arg PORT=4100 \
  -t publira/web-platform:local .

# Server (one image; the container argument picks the process)
docker build -f infra/docker/server/Dockerfile \
  -t publira/publira:local .

docker run --rm publira/publira:local          # publira server
docker run --rm publira/publira:local worker   # publira worker

# publiractl (the migrations, the roles, and all jobs share one image; choose the command with container arguments)
docker build -f infra/docker/publiractl/Dockerfile \
  -t publira/publiractl:local .

docker run --rm -e PUBLIRA_DB_URL publira/publiractl:local db migrate
docker run --rm -e PUBLIRA_DB_URL -v "$PWD/secrets:/run/secrets:ro" publira/publiractl:local db roles \
  --public-password-file /run/secrets/public --admin-password-file /run/secrets/admin \
  --platform-password-file /run/secrets/platform --outbox-password-file /run/secrets/outbox \
  --ticker-password-file /run/secrets/ticker --content-stats-password-file /run/secrets/content-stats
docker run --rm publira/publiractl:local job purge-content-events

# Node
docker build -f infra/docker/node/Dockerfile \
  --build-arg APP_NAME=email-renderer --build-arg PORT=8080 \
  -t publira/email-renderer:local .
```

### Base images

| Stage | Image |
| --- | --- |
| Build | Debian 13 (trixie) image with the full toolchain (`node:*-trixie-slim` / `golang:*-trixie`) |
| Runtime | distroless on Debian 13 (Web / Node: `nodejs24-debian13:nonroot`; publiractl: `static-debian13:nonroot`). The server image alone uses `debian:13.*-slim` plus `libvips42t64` and `libheif-plugin-aomenc` (CGO, for Manael; the plugin encodes AVIF). |

Every base image is pinned by digest under a tag that names its full version and OS release, and Renovate keeps both current.

### Image tags

- **Local builds** are tagged `publira/<service-name>:local`, as in the examples above and in what `task docker:build:*` builds. Deployment defines registry policy separately.
- **Published images** are `ghcr.io/publira/<service-name>:<version>`, the release's Git tag without its `v`, pushed for every release by [`release-images.yml`](../../.github/workflows/release-images.yml) (see [Release images](../../.github/workflows/README.md#release-images)).

### Main runtime environment variables (reference)

- Web: `PORT`, `HOSTNAME` (an image default is present), **`PUBLIRA_AUTH_SECRET` (required; at least 32 bytes; leaving it unset makes session-Cookie encryption and decryption throw)**, **`PUBLIRA_WEB_SERVICE_TOKEN` for web-admin and web-platform (required; the server's `PUBLIRA_WEB_SERVICE_TOKEN`; without it, the app refuses to start)**, and the [`@publira/next-cache-handlers`](https://www.npmjs.com/package/@publira/next-cache-handlers) variables: `PNCH_REDIS_URL` (the server's `PUBLIRA_REDIS_URL` value) and `PNCH_CACHE_APP` (defaults to `APP_NAME` at build time), and `PUBLIRA_REVALIDATE_TOKEN` (the server's value)
- Server: **`PUBLIRA_AUTH_JWT_SECRET` (required for `server`; at least 32 bytes; without it, the process cannot start because it has no access-token signing key)**, and the `PUBLIRA_*_DB_URL` of the roles each process connects as. The binary configures its listeners; the `EXPOSE` lines are documentation metadata.
- Node: `PORT` (default: 8080) and `HOST` (image default: `0.0.0.0`). The email renderer has no external dependencies, so it requires no other variables.

See each service's README and Dockerfile comments for details.

## Responsibilities: Docker builds, local development, and CI

| Path | Purpose | Canonical command |
| --- | --- | --- |
| **Production image build** | Build and verify deployment images | `task docker:build:*` (runs `docker build -f infra/docker/...` with the root context) |
| **Local development** | Hot-reload development | Dev Container plus `task dev` / `task server:dev`, and so on (do not use production Dockerfiles) |
| **CI (images)** | Run `Docker / <target>` after detecting changes | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), using the same local `task docker:build:*` commands |
| **Release images** | Push every deployment image of a tagged release to `ghcr.io/publira` | [`.github/workflows/release-images.yml`](../../.github/workflows/release-images.yml), with the arguments `task docker:verify:full` passes |

Production images and the Dev Container serve different purposes. A successful image build does not replace `task dev`, and the reverse is also true. For the complete CI picture, including host CI (`Check` / `Test / *` / `Build` / `Summary`), see [`.github/workflows/README.md`](../../.github/workflows/README.md).

## Local verification

Prerequisites: run from the repository root with Docker Engine and Buildx available.

### Representative images (routine verification)

The four primary build paths for Issues and CI are the following representatives, one for each role:

```bash
# All at once (web-storefront / publira / publiractl / email-renderer)
task docker:verify

# Or individually
task docker:build:web APP_NAME=web-storefront PORT=3000
task docker:build:server
task docker:build:publiractl
task docker:build:node APP_NAME=email-renderer PORT=8080
```

Runtime smoke tests for distroless images without external dependencies:

```bash
task docker:smoke:web APP_NAME=web-storefront PORT=3000
task docker:smoke:node APP_NAME=email-renderer PORT=8080
```

`smoke:web` checks that the image carries no `sharp` or `@img/*` package, that `/livez` answers, and that `/_next/image` answers 404; `smoke:node` checks the response bodies of both `/livez` and `/readyz`. `smoke:publiractl` brings up its own PostgreSQL. The server image needs the database and object storage as well, so its runtime check is `task deploy:smoke` (see [`infra/deploy/README.md`](../deploy/README.md)), which runs every image together and has image delivery resize an image through libvips.

### All images (before release or after large Dockerfile changes)

```bash
task docker:verify:full
```

This builds every target shown in the README examples in sequence.

### Raw `docker build` (for debugging)

Task is equivalent to the following command. You may run it directly rather than through Task while troubleshooting.

```bash
docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-storefront --build-arg PORT=3000 \
  -t publira/web-storefront:local .
```

## Docker CI jobs

This section covers only the `Docker / <target>` jobs. For path filters and execution strategy across all host CI jobs (`Check` / `Test / Go` / `Test / TypeScript` / `Test / DB Migrations` / `Test / Mobile` / `Test / Mobile E2E` / `Test / E2E` / `Build` / `Summary`), see [`.github/workflows/README.md`](../../.github/workflows/README.md).

Why a pull request builds only the representatives of the roles it touches: [`AGENTS.md`](./AGENTS.md#docker-ci-change-detection-plus-nightly-full-builds).

### Triggers

| Trigger | Mode | Build target |
| --- | --- | --- |
| `pull_request` / `push` (main) with related paths | **verify** | Representatives of changed roles only (table below) |
| Dockerfile, Taskfile, `.dockerignore`, or `ci.yml` changes | **full** | Every target |
| `schedule` (daily at 03:00 UTC) | **full** | Every target (host CI is skipped) |
| `workflow_dispatch` | verify or full | Manual selection via the `docker_mode` input |

### Role mapping for change detection

| Role | Representative target | Watched paths (summary) |
| --- | --- | --- |
| web | `web-storefront` | `apps/**`, `packages/**`, `locales/**`, lockfile / turbo, `infra/docker/web/**` |
| server | `publira` | `server/**`, `infra/docker/server/**` |
| publiractl | `publiractl` | `server/**`, `infra/docker/publiractl/**` |
| node | `email-renderer` | `apps/email-renderer/**`, `packages/**`, `locales/**`, lockfile / turbo, `infra/docker/node/**` |

Changes under `server/**` build the server and publiractl representatives because they share modules. `locales/**` is used by web and node because `@publira/i18n/catalog` and `@publira/email-templates` bundle repository-root message catalogs through relative imports.

Implementation: the `docker` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Job planning: [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh), which turns path-filter results into the Docker matrix. The local commands are the same: `task docker:build:web|server|publiractl|node` (Web then runs `task docker:smoke:web`, and Node then runs `task docker:smoke:node`).

Like other jobs, `Docker / <target>` can be skipped by its path filter. The only required check in the branch ruleset is the final aggregation job **`Summary`** (shown as `CI / Summary` in the UI); skipped intermediate jobs count as success.

## Build-failure triage

Use these steps when a `Docker / <target>` job or local `task docker:build:*` fails. For host-CI jobs (`Check` / `Test / *` / `Build`), see [the CI README's failure triage](../../.github/workflows/README.md#failure-triage).

1. **Identify the failing stage**
   - Image build: Dockerfile path, context, base image, or the build inside the container
   - Smoke only (`/livez` / `/readyz`): entrypoint path, `PORT`, or placement of standalone output or `dist/` (the image build succeeded)
2. **Reproduce with the same local Task**

   Run the `task docker:build:…` line from the CI log as-is.

   ```bash
   task docker:build:web APP_NAME=web-storefront PORT=3000
   # Or run all representatives.
   task docker:verify
   ```

3. **Narrow it down by layer**

   | Symptom | Likely cause |
   | --- | --- |
   | `ERROR: APP_NAME is required` | A missing build argument |
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
