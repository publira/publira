# Contributing to Publira

This page answers three questions for a first-time contributor: what to install, how to check a change, and what a mergeable pull request looks like. It names each rule in a sentence and links to the document that holds it, so there is one copy of every rule to maintain. [`README.md`](README.md) covers how to run the product itself.

## Ways to contribute

- **Issues.** Open one on GitHub for a bug, a feature, or a task. Write the title and body in English, say what happened and what you expected, and name the app or service it concerns.
- **Pull requests.** Every change to `main` arrives as a pull request from a branch, as described under [Commits and pull requests](#commits-and-pull-requests). For anything larger than a fix, open an Issue first so the approach can be agreed before the work is done.
- **Discussion** happens on the Issue or the pull request itself. There is no separate forum or chat.

## Development environment

### Dev Container (the supported path)

The repository ships a Dev Container under [`.devcontainer/`](.devcontainer/devcontainer.json) with every tool below preinstalled, so a contributor who uses it installs nothing but Docker and an editor that speaks the Dev Container protocol (VS Code with the Dev Containers extension, or the `devcontainer` CLI). The container image is `ghcr.io/publira/base-images/publira-dev`, built in the `publira/base-images` repository, and its `postCreateCommand` runs `task setup`, which installs dependencies and initializes the database and the object storage bucket. The definition asks the host for four CPUs.

The dependency services — PostgreSQL, Valkey, RustFS, Mailpit, Jaeger, and a Traefik edge — start with the container. The [Dependency services](README.md#dependency-services) section of the README explains how the container reaches them and which ports it forwards.

### On the host

Outside the Dev Container you install the toolchain yourself. The versions below are the ones CI runs, taken from the same files CI reads; Renovate raises those pins, so when this table and the file disagree, the file is right.

| Tool | Version | Where the pin lives | Needed for |
| --- | --- | --- | --- |
| [Task](https://taskfile.dev/) | 3.53.1 | `TASK_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Every `task` command |
| Docker Engine with Compose v2 | Any current release | Not pinned | The dependency services, the Testcontainers tests in `task server:test`, E2E |
| [pnpm](https://pnpm.io/) | 11.25.0 | `packageManager` in [`package.json`](package.json) | The web apps and shared packages |
| Node.js | 24.20.0 | `devEngines.runtime` in [`package.json`](package.json) | Downloaded by pnpm on demand (`onFail: download`); nothing to install by hand |
| Go | 1.27.1 | `go-version` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); [`server/go.mod`](server/go.mod) states the minimum the module accepts | The Go backend |
| libvips | The distribution's `libvips-dev` and `pkg-config` | Not pinned; installed by the Go jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Building and testing the Go backend, whose image servers link libvips through Manael |
| [golangci-lint](https://golangci-lint.run/) | 2.13.2 | `GOLANGCI_LINT_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task server:lint` |
| [sqlc](https://sqlc.dev/) | 1.31.1 | `SQLC_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task gen` and `sqlc diff` |
| [buf](https://buf.build/) | 1.72.0 | `BUF_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task gen` |
| [golang-migrate](https://github.com/golang-migrate/migrate) | 4.19.1 | `MIGRATE_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task db:*` |
| PostgreSQL client (`psql`) | Any current release | Not pinned | `task db:setup` (the seeds) and `task db:console` |
| AWS CLI | Any current release | Not pinned | `task storage:init` |
| [Flutter](https://docs.flutter.dev/get-started/install) | 3.47.2 | `FLUTTER_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); [`mobile/pubspec.yaml`](mobile/pubspec.yaml) states the Dart SDK constraint | The mobile app; [`scripts/setup-flutter.sh`](scripts/setup-flutter.sh) installs the pinned SDK on a workstation as it does in CI |
| [wait4x](https://github.com/wait4x/wait4x) | 3.7.1 | `WAIT4X_VERSION` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `task e2e` and `task e2e:bootstrap` |

With the tools installed:

1. Start the dependency services with `docker compose up -d` from the repository root.
2. Export the environment variables listed under [Running `task setup` / `task dev` on the host](README.md#running-task-setup--task-dev-on-the-host) in the README. The defaults name the Compose services, which resolve only inside the Dev Container.
3. Run `task setup`. It installs the Node.js and Go dependencies, runs `flutter pub get`, applies the migrations and the seed, and creates the storage bucket. Without Flutter, run the pieces you need instead: `task deps`, `task db:setup`, and `task storage:init`.
4. Run `task dev` to start every server and web app, or the per-area tasks that `task --list` shows.

The shortest path to a green check needs only Task, pnpm, Go, and libvips: `task deps` followed by the commands in the next section.

## Verifying a change

Run the commands that match the area you changed, from the repository root. They are the same commands CI runs, and each area's guide explains them in full.

| Area | Commands | Guide |
| --- | --- | --- |
| `apps/`, `packages/`, `locales/`, `scripts/*.ts` | `pnpm preflight` (locale catalog, `typegen`, `typecheck`, `check`, `test`, `test:scripts`) | [`apps/AGENTS.md`](apps/AGENTS.md) |
| `server/` | `task server:lint`, `task server:test-short`, and `task server:test` before finishing (it needs Docker for Testcontainers); `task server:build` when `cmd/` changes | [`server/AGENTS.md`](server/AGENTS.md) |
| `proto/`, `db/migrations/`, `db/query/`, `sqlc.yaml`, `buf.gen.yaml` | `task gen`, then `sqlc diff` must be clean, then the `server/` commands again; commit the regenerated output | [`server/AGENTS.md`](server/AGENTS.md), [`db/AGENTS.md`](db/AGENTS.md), [`proto/README.md`](proto/README.md) |
| `db/migrations/` | `task db:reset`; the history is append-only, so fix a mistake with a new migration rather than by editing one | [`db/AGENTS.md`](db/AGENTS.md) |
| `mobile/` | `task mobile:check` | [`mobile/README.md`](mobile/README.md) |
| Behaviour that spans the web apps and the API | `task e2e` | [`e2e/README.md`](e2e/README.md) |
| Everything | `pnpm check` formats and lints every file type oxfmt supports, Markdown included | [`AGENTS.md`](AGENTS.md) |

When a CI run is red, [`.github/workflows/README.md`](.github/workflows/README.md) lists which job checks what and the local command that reproduces each one.

## Commits and pull requests

- **Branch from `main`** and open a pull request against it. Nothing is pushed to `main` directly, and a squash merge is the only merge method the branch rules allow.
- **Commit subjects and pull request titles use [Conventional Commits](https://www.conventionalcommits.org/)**, in English: `type(scope): description`. The pull request title becomes the subject of the squashed commit and the body becomes its message, so both are read from `git log` long after the pull request is closed.
- **Fill in the pull request template** at [`.github/pull_request_template.md`](.github/pull_request_template.md). GitHub loads it into every new pull request; keep its headings.
- **Disclose a coding agent with an `Assisted-by` trailer, never a co-author trailer.** The full rule and its reasons are in the [AI agent trailer](AGENTS.md#ai-agent-trailer-assisted-by-never-co-authored-by) section of `AGENTS.md`. In short: the trailer discloses the process, a co-author line would claim authorship an AI cannot hold. Pass it with `--trailer` so Git records a real trailer:

  ```bash
  git commit -m "feat(web-host): add episode access gate" \
    --trailer "Assisted-by: Claude Code:claude-opus-5"
  ```

- **Commit with an email address linked to your GitHub account.** The branch rules require an extra approval for a pull request whose commits are not attributed to a GitHub user.
- **What the branch rules require before a merge**: the `CI / Summary` check passes on a branch that is up to date with `main`, one approving review is in place, and every review thread is resolved. A new push dismisses earlier approvals, so rebase onto `main` and push before asking for a review rather than after.
- **Keep one Issue per pull request.** Link it with `Fixes #NNN` in the body so the merge closes it. When a change needs several pull requests, split the Issue rather than the fix.

## Language

Everything this repository publishes is English: the Markdown documents, GitHub Issues, pull request titles and bodies, commit messages, and the labels of automated tests (`describe` / `it`, `test`, `t.Run`, `group` / `testWidgets`). Japanese appears only where it is quoted as code: a UI string in an example, the values in `locales/*.json`, and test fixtures. The rule and its edge cases are in the [Documentation, test labels, and GitHub Issues: English](AGENTS.md#documentation-test-labels-and-github-issues-english) section of `AGENTS.md`.

## Where the conventions live

The rules are written for coding agents and humans alike, and they are kept next to the code they govern. This page links to them rather than restating them.

| Document | What it governs |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Repository-wide policy: language, commit trailers, environment variable names, TypeScript on Node.js, React Effects, `Temporal`, the Next.js cache, and the map of the guides below |
| [`apps/AGENTS.md`](apps/AGENTS.md) | The Next.js apps and shared packages; each app's own `AGENTS.md` holds only its Next.js-generated rules |
| [`server/AGENTS.md`](server/AGENTS.md) | The Go backend and its verification checklist |
| [`db/AGENTS.md`](db/AGENTS.md) | Migrations, sqlc queries, and seeds |
| [`proto/README.md`](proto/README.md) | Cross-RPC contract decisions such as cursor pagination |
| [`.github/workflows/README.md`](.github/workflows/README.md) | CI job layout, path filters, and failure triage |
| [`infra/docker/README.md`](infra/docker/README.md) | Production Dockerfiles and their build verification |
| [`skills/`](skills/) | Repository-owned skills for coding agents: the coding standards in full, how to open a pull request, the isolated development profile, and Issue organization |
