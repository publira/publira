# Infra Docker Agent Guide

Conventions for production container images under `infra/docker/`. Prefer this file for Docker image work; root [AGENTS.md](../../AGENTS.md) remains the top-level source of truth for repo-wide agent policy.

Which Dockerfile builds what and the build ARGs each takes, the build and verification commands, the `Docker / <target>` jobs, and build-failure triage are reference, in [`README.md`](./README.md).

## Placement

Shared Dockerfiles are grouped by runtime role under `infra/docker/<role>/`, and build `ARG`s select the target.

1. **One Dockerfile per runtime role**, not per service. Switch target with build `ARG`s.
2. **Build context is always the repository root** (`.`). Use  
   `docker build -f infra/docker/<role>/Dockerfile ... .`
3. **Do not** add `apps/*/Dockerfile` or `server/cmd/*/Dockerfile`, generated copies included.
4. **Do not** reintroduce template → copy expansion under service directories, and never commit a Dockerfile generated from a template.
5. **Keep the Dev Container out of it.** Its image, `ghcr.io/publira/base-images/publira-dev`, is built in the `publira/base-images` repository, and `.devcontainer/` holds only the configuration that runs it. It is a development image with a toolchain and volumes, not a production runtime, so no production image logic goes into it.
6. A temporary verification Dockerfile lives only on a personal branch. To keep one on `main`, promote it to a new role under `infra/docker/`.

### Why one Dockerfile per role

| Option | Decision | Reason |
| --- | --- | --- |
| Dockerfile under each service (the old policy) | Rejected | It duplicates the same image shape many times, making base-image digest and build-process updates inconsistent. |
| `infra/docker/templates/` copied to each command | Rejected | It creates two sources of truth—the template and generated output—which can drift. |
| **One Dockerfile per role plus `ARG`** (current) | **Adopted** | Each runtime has one file and only its build target changes. The root context handles the monorepo and `server/` correctly. |
| Combine Dev Container and production images | Rejected | Development tools (`task`, `sqlc`, Flutter, and more) have different responsibilities from a minimal runtime image. |

Role-based paths, the links from the README, and the `infra/docker/` entry in the repository layout of the root `CONTRIBUTING.md` retain the discoverability advantage of keeping a Dockerfile beside each service. Dockerfile header comments are the source of truth for implementation details such as `turbo prune` and Go `cmd` paths.

### Which image a new service goes into

```text
What is being containerized?
├─ A Next.js app (apps/<name>)
│    → infra/docker/web/Dockerfile
│    → --build-arg APP_NAME=<name>   # package name is @publira/<name>
│    → Set PORT when needed (default: 3000)
│
├─ A long-lived Go process (`publira server` or `publira worker`)
│    → infra/docker/server/Dockerfile (no build ARG; one image for both)
│    → Select the process with container arguments: docker run publira/publira:local worker
│
├─ The database migrations, or a Go maintenance job (run by hand; the worker schedules it)
│    → infra/docker/publiractl/Dockerfile (no build ARG; carries db/migrations)
│    → Select the command with container arguments: docker run publira/publiractl:local db migrate, or job <kind>
│
├─ A third-party service the dev or E2E stack needs with something added (an engine plugin)
│    → infra/docker/<service>/Dockerfile, FROM the published image, built by compose
│    → No build ARG, no task docker:build:* target
│
├─ A long-running non-Next.js Node.js service (apps/<name>)
│    → infra/docker/node/Dockerfile
│    → --build-arg APP_NAME=<name>   # package name is @publira/<name>
│    → Set PORT when needed (default: 8080)
│
└─ Another runtime (for example, a worker in another language)
     → Add a new role at infra/docker/<role>/Dockerfile and add it to the README's layout table
     → Do not force it into an existing role
```

A new **maintenance job** is not a new target: it is a `publiractl job` subcommand, carried by the publiractl image as it is.

### Naming

- **Role directories** use a short category name (`web` / `server` / `node`), never a service name. `publiractl` is the exception: it carries one binary, which the directory is named for, and so are `opensearch` and `elasticsearch`, which each carry one third-party service.
- **`APP_NAME`** is the directory name directly under `apps/` (for example, `web-admin` or `email-renderer`). The Dockerfile adds the `@publira/` prefix.

## Implementation rules

1. **Multi-stage**: build on Debian toolchain images; run on **distroless `nonroot`**.
   - Web / Node: `node:*-trixie-slim` → `gcr.io/distroless/nodejs*-debian13:nonroot`
   - publiractl: `golang:*-trixie` → `gcr.io/distroless/static-debian13:nonroot`, never the unsuffixed `static` alias, which follows whichever Debian release distroless currently builds on
   - server: `golang:*-trixie` + `libvips-dev` → `debian:13.*-slim` + `libvips42t64` + `libheif-plugin-aomenc` (CGO; distroless/static cannot load libvips, and the worker is the same binary; libvips42t64 brings libheif's decoders only, and AVIF output needs the encoder plugin)
   - The build and runtime stages of one image share a Debian release, and move to a new one together. Web / Node copy `node_modules` built in the build stage into the runner, native addons included whenever a dependency brings one, and the server binary links libvips, so a glibc or shared-library mismatch fails at run time, not at build time.
   - Shared-library package names follow the Debian release: Debian 13's 64-bit `time_t` transition renamed `libvips42` to `libvips42t64`.
2. **Pin base images by digest, and tag them with what the digest is** (`image:tag@sha256:…`). The rule covers every `FROM` line, every `# syntax=` frontend, and every compose `image:` in the repository, wherever the file lives, not only the Dockerfiles here.
   - The digest is the pin. The tag names the image's full version and its OS release, so a Renovate pull request shows in its diff and title which version the image moves from and to:

     | Write | Not | Why |
     | --- | --- | --- |
     | `node:24.21.0-trixie-slim` | `node:24-trixie-slim` | A line-only tag moves to a new patch release with only the digest changing in the diff |
     | `golang:1.27.1-trixie` | `golang:1.27-trixie` | The same, for the Go patch release |
     | `debian:13.7-slim` | `debian:trixie-slim` | The same, for the point release |
     | `valkey/valkey:9.1.2-alpine3.24` | `valkey/valkey:9.1.2-alpine` | A bare `-alpine` follows whichever Alpine release the publisher builds on, so a digest-only update could move musl and every package |

   - The `node` tag names the version in `devEngines.runtime.version` of the root `package.json`, the runtime contributors run. Renovate raises both, and the `node` images in the compose files, on one branch.
   - Exceptions, for publishers that offer nothing more to name: distroless publishes no versioned tags, so its image name carries the Debian release (`nodejs24-debian13`, `static-debian13`, never the unsuffixed `static` alias) and the digest is the only further identifier; caddy publishes no Alpine-versioned tags, so `caddy:<version>-alpine` keeps a bare `-alpine`; OpenSearch (`opensearchproject/opensearch:3.9.0`) and Elasticsearch (`elasticsearch:9.1.5`) tag their images with the version alone, naming no OS.
   - Moving to a new OS release (Alpine 3.24 → 3.25, Debian 13 → 14) is an edit by hand. Renovate's Docker versioning treats the part of the tag after the version as a compatibility marker and never changes it, so its pull requests move the version and the digest within the OS release the tag names. An image staying on an older OS release after a newer one has shipped is that behaviour, not a missed update.
3. **Tool versions** (`pnpm`, `turbo`, …) as `ARG *_VERSION` with a Renovate comment, as `web/Dockerfile` does:

   ```dockerfile
   # renovate: datasource=npm depName=turbo versioning=semver
   ARG TURBO_VERSION=2.10.8
   ```

4. **No Docker `HEALTHCHECK`** in any runner: which port to ask is the container's choice — `server`, `worker`, and `server --with-worker` answer on different ones, and `PORT` can be overridden — not the image's. Orchestrator probes for server / Web:
   - liveness `GET /livez`
   - readiness `GET /readyz`

   A healthcheck that has to run inside the container, as a Compose `healthcheck` does, runs what the image already carries: `bash` with `/dev/tcp` in the server image, and `node -e` with `fetch` in the web and node images. Nothing is added to an image for it — no `curl`, no `wget`, no probe binary — since every tool a runner carries is one more an attacker who gets into the container can use.

5. **Web**: follow [Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker) (`turbo prune --docker`). Keep standalone path stable for distroless `CMD` (pack stage may normalize to `apps/web`). `turbo prune` does not carry repo-root assets; `@publira/i18n/catalog` imports `locales/*.json` relatively, so the builder stage `COPY`s `locales/` explicitly.
6. **Node**: also `turbo prune --docker`, but there is no standalone output. The runner gets a `pnpm install --frozen-lockfile --prod` tree plus every workspace `dist/`; sources and dev dependencies stay in the builder, and the pack stage renames `apps/${APP_NAME}` to `apps/node` so the distroless `CMD` is a fixed path. Two consequences:
   - Anything the compiled output imports at runtime must sit in a `dependencies` field. A `devDependencies` / unmet `peerDependencies` entry disappears under `--prod` and the container dies on `Cannot find package`.
   - `turbo prune` does not carry repo-root assets. `@publira/email-templates` imports `locales/*.json` relatively, so the builder stage `COPY`s `locales/` explicitly.
7. **publiractl**: `CGO_ENABLED=0`. Redeclare `ARG TARGETOS` / `ARG TARGETARCH` **without defaults** so BuildKit’s automatic platform values apply (defaults would pin amd64 even under `--platform linux/arm64`).
8. **server**: `CGO_ENABLED=1` and do **not** set `GOOS`/`GOARCH`. CGO cannot be cross-compiled here; Buildx `--platform` must match the builder. The runner is debian-slim with `libvips42t64` because Manael links libvips, and `publira worker` runs on the same image because it is the same binary.
9. Keep root [`.dockerignore`](../../.dockerignore) in mind; do not rely on shipping `node_modules` / `.next` from the host.
10. **Do not** use Alpine for the Next.js **build** when the runner is Debian-based distroless (glibc / any native addon in the copied `node_modules`).

## Docker CI: change detection plus nightly full builds

A pull request builds only the representative target of each role its paths touch, and the nightly run builds every target. The README's [Docker CI jobs](./README.md#docker-ci-jobs) lists the triggers and the paths each role watches.

| Strategy | Contents | Benefit | Drawback |
| --- | --- | --- | --- |
| **Build every image every time** | Every target on every PR | Least chance of missing a problem | High time and cost, especially Web × 3 |
| **Detect changes** | Build only the representative of affected roles | Fast PRs | May miss indirect effects outside the role |
| **Nightly full** | Build all targets periodically | Detects drift | Slow feedback |

Change detection alone keeps pull requests fast but misses an effect that reaches a role through a path it does not watch, and the nightly full build catches that drift within a day without making every pull request pay for Web × 3. A change to a Dockerfile, the Taskfile, `.dockerignore`, or `ci.yml` can break any target, so it builds them all.

Host CI as a whole (jobs, path filters, triage): [`.github/workflows/README.md`](../../.github/workflows/README.md).

## Change checklist

- [ ] For a new role, added `infra/docker/<role>/Dockerfile`, added it to the README's layout table and build examples, and added its branch to the decision flow above
- [ ] For a new target, updated the README's build examples, [`Taskfile.yaml`](./Taskfile.yaml) `verify:full`, the Docker full matrix in [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh), and the image matrix in [`release-images.yml`](../../.github/workflows/release-images.yml) together
- [ ] Pinned base-image digests under tags that name the full version and the OS release, and made tool-version `ARG`s trackable by Renovate
- [ ] Built from the repository root through `task docker:build:*`, the same entrypoint CI uses, and passed `task docker:verify` (and `task docker:verify:full` after a large Dockerfile change); the commands are in the README's [Local verification](./README.md#local-verification)
- [ ] The `infra/docker/` entry in the repository layout of the root [CONTRIBUTING.md](../../CONTRIBUTING.md#repository-layout) still describes this directory

When a build fails: the README's [Build-failure triage](./README.md#build-failure-triage).
