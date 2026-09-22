# Contributing to Publira

This page answers three questions for a first-time contributor: what to install, how to check a change, and what a mergeable pull request looks like. It names each rule in a sentence and links to the document that holds it, so there is one copy of every rule to maintain. [`README.md`](README.md) covers how to run the product itself.

## Repository layout

```text
.
├── apps/               # [Node.js] Web apps (Turborepo)
│   ├── web-host/       # Tenant-facing site (catalog / auth / my page)
│   ├── web-admin/      # Submission and management console for publishers and editors
│   ├── web-platform/   # Cross-tenant operations console for platform operators
│   └── email-renderer/ # Node service that renders React Email over ConnectRPC
├── packages/           # [Node.js] Shared UI and utilities
├── e2e/                # [Playwright] Cross-app E2E foundation
├── server/             # [Go] Backend system (single module)
│   ├── cmd/
│   │   ├── api-server/       # ConnectRPC API server
│   │   ├── publiractl/       # The command that operates an install (`publiractl job <kind>` runs a maintenance job by hand)
│   │   └── worker/           # Long-lived background worker (Outbox drain + every scheduled job)
│   └── internal/
│       ├── db/gen/     # sqlc generated code (DB/Go)
│       └── proto/gen/  # buf generated code (Go)
├── infra/
│   ├── docker/         # Production Dockerfiles (per role, built from the repository root)
│   └── proxy/          # Edge routing, written for Traefik, nginx, and Caddy
├── mobile/             # [Flutter] Mobile app (iOS/Android)
├── proto/              # Protocol Buffers schema definitions
├── locales/            # Shared UI messages (JSON, read by Go / Web / Flutter alike)
├── assets/             # Vector sources for the JPEGs the repository commits, and where each renders to
└── db/                 # PostgreSQL migrations and queries
```

Each area carries its own documentation: the `README.md` of a directory is the reference for what it holds and how to run it, and an `AGENTS.md` states the conventions a change there must follow. There is no central index of them; [Where the conventions live](#where-the-conventions-live) says how to find the ones that apply to a change.

## Ways to contribute

- **Issues.** Open one on GitHub for a bug, a feature, or a task. Write the title and body in English, say what happened and what you expected, and name the app or service it concerns.
- **Pull requests.** Every change to `main` arrives as a pull request from a branch, as described under [Commits and pull requests](#commits-and-pull-requests). For anything larger than a fix, open an Issue first so the approach can be agreed before the work is done.
- **Discussion** happens on the Issue or the pull request itself. There is no separate forum or chat.

## Development environment

### Dev Container (the supported path)

The repository ships a Dev Container under [`.devcontainer/`](.devcontainer/devcontainer.json) with every tool below preinstalled, so a contributor who uses it installs nothing but Docker and an editor that speaks the Dev Container protocol (VS Code with the Dev Containers extension, or the `devcontainer` CLI). The container image is `ghcr.io/publira/base-images/publira-dev`, built in the `publira/base-images` repository, and its `postCreateCommand` runs `task setup`, which installs dependencies and initializes the database and the object storage bucket. The definition asks the host for four CPUs.

The dependency services — PostgreSQL, Valkey, RustFS, Mailpit, Jaeger, and a Traefik edge — start with the container. The [Dependency services](README.md#dependency-services) section of the README explains how the container reaches them and which ports it forwards.

### On the host

Outside the Dev Container you install the toolchain yourself. Install the version each pin names: the pins are the ones CI runs, Renovate keeps them current, and this page deliberately does not repeat their values, so it never disagrees with them.

| Tool | Where the pin lives | Needed for |
| --- | --- | --- |
| [Task](https://taskfile.dev/) | `TASK_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Every `task` command |
| Docker Engine with Compose v2 | Not pinned | The dependency services, the Testcontainers tests in `task server:test`, E2E |
| [pnpm](https://pnpm.io/) | `packageManager` in [`package.json`](package.json) | The web apps and shared packages |
| Node.js | `devEngines.runtime` in [`package.json`](package.json) | Downloaded by pnpm on demand (`onFail: download`); nothing to install by hand |
| Go | `go-version` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); [`server/go.mod`](server/go.mod) states the minimum the module accepts | The Go backend |
| libvips (`libvips-dev` and `pkg-config`) | Not pinned; installed by the Go jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Building and testing the Go backend, whose image servers link libvips through Manael |
| [golangci-lint](https://golangci-lint.run/) | `GOLANGCI_LINT_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task server:lint` |
| [sqlc](https://sqlc.dev/) | `SQLC_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task gen` and `sqlc diff` |
| [buf](https://buf.build/) | `BUF_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task gen` |
| [golang-migrate](https://github.com/golang-migrate/migrate) | `MIGRATE_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task db:*` |
| PostgreSQL client (`psql`) | Not pinned | `task db:setup` (the seeds) and `task db:console` |
| AWS CLI | Not pinned | `task storage:init`, `task storage:seed` |
| [Flutter](https://docs.flutter.dev/get-started/install) | `FLUTTER_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); [`mobile/pubspec.yaml`](mobile/pubspec.yaml) states the Dart SDK constraint | The mobile app; [`scripts/setup-flutter.sh`](scripts/setup-flutter.sh) installs the pinned SDK on a workstation as it does in CI |
| [wait4x](https://github.com/wait4x/wait4x) | `WAIT4X_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task e2e` and `task e2e:bootstrap` |

With the tools installed:

1. Start the dependency services with `docker compose up -d` from the repository root.
2. Export the environment variables listed under [Running `task setup` / `task dev` on the host](README.md#running-task-setup--task-dev-on-the-host) in the README. The defaults name the Compose services, which resolve only inside the Dev Container.
3. Run `task setup`. It installs the Node.js and Go dependencies, runs `flutter pub get`, applies the migrations and the seed, and fills the storage bucket with the images that seed's rows name. Without Flutter, run the pieces you need instead: `task deps`, `task db:setup`, and `task storage:seed`.
4. Run `task dev` to start every server and web app, or the per-area tasks that `task --list` shows.

The shortest path to a green check needs only Task, pnpm, Go, and libvips: `task deps` followed by the commands in the next section.

### Working in several worktrees

When you work in several worktrees in parallel, pick a profile per worktree instead of sharing the default development environment. A profile separates the PostgreSQL database, the Valkey logical database, the RustFS bucket, the ports of every service, the cookie names, and the authentication and revalidation secrets. The plain `task setup` / `task dev` keep using the shared environment as before. A profile records where PostgreSQL, Valkey, and RustFS are when it is created: the hosts named by `PUBLIRA_DB_URL`, `PUBLIRA_REDIS_URL`, and `PUBLIRA_S3_ENDPOINT` in the shell that runs `task dev-env:create`, or the Compose service names when those are not exported. Inside the Dev Container nothing needs to be set. On the host, export the loopback variables listed under [Running `task setup` / `task dev` on the host](README.md#running-task-setup--task-dev-on-the-host) first, as for the plain `task setup`.

```bash
# Once per new worktree (the identifier takes lowercase alphanumerics and -)
task dev-env:create NAME=issue-1178

# Database migration/seed and creation of the dedicated bucket. Safe to re-run.
task dev-env:init

# Start the API, image server, worker, email-renderer, and the three Next.js
# apps together, behind an edge of this profile's own
task dev-env:start

# Show the URLs, the logs, and the assigned DB/Redis/bucket
task dev-env:show

# When you are done. Data is kept.
task dev-env:stop
```

All three apps of a profile answer on one address, the port the profile's own edge listens on: it is the tenant site, `admin.localhost` on the same port is the tenant console, and `platform.localhost` the platform console, the way `localhost:3080` works in the Dev Container. That edge is a Traefik container running the routing every environment runs ([`infra/proxy/README.md`](infra/proxy/README.md)) against the profile's ports, so `task dev-env:start` needs Docker and `task dev-env:stop` takes the container down with the processes. Reaching an app on the port it listens on itself skips the edge, and `/images…` belongs to the image server rather than to any app, so a page opened that way shows every eye-catch, logo, and episode page as a broken image.

Load the same environment variables first when starting a single app as well. Each app's `dev` honors `PORT`, so you do not have to resolve default port collisions by hand.

```bash
eval "$(task --silent dev-env:env)"
pnpm dev --filter @publira/web-host
```

`task dev-env:list` shows every profile and the worktree that selected it. To discard one, run `task dev-env:destroy NAME=<name>`. It checks that no worktree has the target selected and that it is stopped, then deletes only that profile's database, Redis DB, and bucket after you retype the name. It does not touch the shared development environment, E2E, or other profiles.

A profile records the shape it was written in, and a command that loads one refuses any other shape, naming the file and the commands that replace it. Profiles are not migrated: they hold nothing but local settings, and `task dev-env:destroy NAME=<name>` followed by `task dev-env:create` and `task dev-env:init` rebuilds one from the current shape.

A profile's secrets and run logs are stored under `~/.publira/dev-env` by default. Override the location with `PUBLIRA_DEV_ENV_HOME` only when you need to. The scripts create and drop a profile's database as the `postgres` superuser of `compose.yaml` on the profile's PostgreSQL host; `PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL` replaces that connection for a server with other credentials. Both variables are read solely by the development environment scripts.

## Verifying a change

Run the commands that match the area you changed, from the repository root. They are the same commands CI runs.

| Area | Commands |
| --- | --- |
| `apps/`, `packages/`, `locales/`, `scripts/*.ts` | `pnpm preflight` (locale catalog, `typecheck`, `check`, `test`, `test:scripts`) |
| `server/` | `task server:lint`, `task server:test-short`, and `task server:test` before finishing (it needs Docker for Testcontainers); `task server:build` when `cmd/` changes |
| `proto/`, `db/migrations/`, `db/query/`, `sqlc.yaml`, `buf.gen.yaml` | `task gen`, then `sqlc diff` must be clean, then the `server/` commands again; commit the regenerated output |
| `db/migrations/` | `task db:reset`; the history is append-only once merged, so fix a mistake in a migration already on `main` with a new migration rather than by editing it |
| `mobile/` | `task mobile:check` |
| Behaviour that spans the web apps and the API | `task e2e` |
| Everything | `pnpm check` formats and lints every file type oxfmt supports, Markdown included |

When a CI run is red, [`.github/workflows/README.md`](.github/workflows/README.md) lists which job checks what and the local command that reproduces each one.

## Commits and pull requests

- **Branch from `main`** and open a pull request against it. Nothing is pushed to `main` directly.
- **Commit subjects and pull request titles use [Conventional Commits](https://www.conventionalcommits.org/)**, in English: `type(scope): description`. The pull request title and body become the commit message on `main`, so both are read from `git log` long after the pull request is closed.
- **Fill in the pull request template** at [`.github/pull_request_template.md`](.github/pull_request_template.md). GitHub loads it into every new pull request; keep its headings.
- **Disclose a coding agent with an `Assisted-by` trailer, never a co-author trailer.** The full rule and its reasons are in the [AI agent trailer](AGENTS.md#ai-agent-trailer-assisted-by-never-co-authored-by) section of `AGENTS.md`. In short: the trailer discloses the process, a co-author line would claim authorship an AI cannot hold. Pass it with `--trailer` so Git records a real trailer:

  ```bash
  git commit -m "feat(web-host): add episode access gate" \
    --trailer "Assisted-by: Claude Code:claude-opus-5"
  ```

- **Keep one Issue per pull request.** Link it with `Fixes #NNN` in the body so the merge closes it. When a change needs several pull requests, split the Issue rather than the fix.

## Language

Everything this repository publishes is English: the Markdown documents, GitHub Issues, pull request titles and bodies, commit messages, and the labels of automated tests (`describe` / `it`, `test`, `t.Run`, `group` / `testWidgets`). Japanese appears only where it is quoted as code: a UI string in an example, the values in `locales/*.json`, and test fixtures. The rule and its edge cases are in the [Documentation, test labels, and GitHub Issues: English](AGENTS.md#documentation-test-labels-and-github-issues-english) section of `AGENTS.md`.

## Where the conventions live

The rules are kept next to the code they govern, in two kinds of file, and there is deliberately no index of them: an index has to be edited every time a directory gains or loses one, and the copy that is forgotten is the one a reader trusts.

- An **`AGENTS.md`** states the conventions a change under its directory must follow and the commands that verify it. The root [`AGENTS.md`](AGENTS.md) holds the repository-wide policy — the language rule, the commit trailer, environment variable names, the coding standards — and each domain's file holds what is specific to that domain.
- A **`README.md`** is the reference for what a directory holds, what it exports or serves, the environment variables it reads, and how to run it.

Before changing a file, read the `AGENTS.md` and the `README.md` in its directory and in every directory above it, up to the repository root. Every one of them applies, and the nearest one is the most specific. The same walk lists them for you:

```bash
git diff --name-only origin/main...HEAD | while read -r file; do
  dir=$(dirname "$file")
  while :; do
    for doc in AGENTS.md README.md; do [ -f "$dir/$doc" ] && echo "$dir/$doc"; done
    [ "$dir" = "." ] && break
    dir=$(dirname "$dir")
  done
done | sort -u
```

The rules are written for coding agents and human contributors alike.
