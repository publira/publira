# GitHub Actions workflows

| Workflow | File | Purpose |
| --- | --- | --- |
| `CI` | [`ci.yml`](./ci.yml) | Validation jobs described below. |
| `Skills Update` | [`skills-update.yml`](./skills-update.yml) | Weekly pull requests that update agent skills. |
| `Organize issues` | [`organize-issues.yml`](./organize-issues.yml) | Issue-maintenance automation. |
| `Regenerate` | [`regenerate.yml`](./regenerate.yml) | Stacked pull requests that regenerate output for a generator version bump. |

## Organize issues

[`organize-issues.yml`](./organize-issues.yml), named `Organize issues`, is the home for Issue-maintenance jobs. Add work by job; it uses `actions/github-script` and does not check out the repository.

| Displayed job | Purpose |
| --- | --- |
| `Close completed epics` | Close an `epic` Issue as `completed` when all native sub-issues are closed. |

`Close completed epics` is triggered by a closed Issue and manual `workflow_dispatch` (which scans open `epic` Issues if no number is supplied). It considers only `epic` parents with at least one sub-issue, walks nested Epic ancestors in one run, and is serialized to avoid missed simultaneous closures. A `GITHUB_TOKEN` close does not trigger another run.

## Regenerate

[`regenerate.yml`](./regenerate.yml), named `Regenerate`, keeps generated output in step with the generators that produce it. Renovate raises the pinned remote plugin versions in `buf.gen.yaml` and the `SQLC_VERSION` / `BUF_VERSION` values in the `env` block of [`ci.yml`](./ci.yml), but it does not regenerate, so those pull requests arrive with the previous output still committed. This workflow runs `task gen` on such a pull request and, when the result differs from the committed tree, opens a **stacked pull request** whose base is the original branch and whose only content is the regenerated files.

It is triggered by `pull_request` on `buf.gen.yaml`, `ci.yml`, and itself, and it skips forks (their `GITHUB_TOKEN` is read-only) and branches that start with `regen/` (a stacked branch must not stack on itself). Tool setup uses the same actions and the same pinned versions as the `Check` job, so the regenerated files match what that job then verifies.

The original branch is never written to. Renovate force-pushes when it rebases, which would discard a commit placed there. The stacked branch is a separate `regen/<original branch>` ref, rebuilt by [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request) on every run: a second run updates the existing pull request instead of opening another one, and a run that produces no diff opens nothing and closes a pull request left over from an earlier run.

The stacked pull request is opened by `github-actions[bot]`, so its checks start only after a user with write permission approves the run. `CI` needs no trigger change to see it: GitHub treats a pull request whose base is another open pull request's branch as part of a stack and starts workflows as if it targeted the stack's base, which is `main`. Merge the stacked pull request into the original branch first, then the original pull request into `main`. Merging into a Renovate branch marks that branch as modified, and Renovate then stops updating it until someone ticks its rebase checkbox — which regenerates the branch and drops the regenerated commit with it.

# CI workflow

[`ci.yml`](./ci.yml), named `CI`, defines job layout, triggers, path filters, and failure triage. This file is the primary source of truth for _which jobs run when_; domain READMEs and AGENTS files define _what each job verifies_.

Implementation:

- Workflow: [`ci.yml`](./ci.yml)
- Job planning—selected jobs and Docker matrix: [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh)

[`infra/docker/README.md`](../../infra/docker/README.md) is authoritative for Docker image placement, build steps, and Docker-specific triage. This document covers only how the `Docker` job is started by CI.

## Jobs

| Displayed job | Contents | Details |
| --- | --- | --- |
| `Detect changes` | Evaluate path filters and select jobs and Docker matrix entries. | This file |
| `Lint and Format` | `pnpm check` across every file type that oxfmt supports. | [`AGENTS.md`](../../AGENTS.md) |
| `Check` | Locale-catalog, `sqlc`, and buf-generated drift; package builds; `pnpm typegen`, literal-`<svg>` grep, and `pnpm typecheck`. | [`AGENTS.md`](../../AGENTS.md) |
| `Lint / Go` | `golangci-lint run ./...` in `server/`. | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / Go` | `go test ./...` in `server/`. | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / TypeScript` | `pnpm test` after package builds. | [`apps/AGENTS.md`](../../apps/AGENTS.md) |
| `Test / DB Migrations` | Append-only guard on `db/migrations/`, then empty Postgres: `migrate up` → `down -all` → `up`. | [`db/AGENTS.md`](../../db/AGENTS.md) |
| `Test / Mobile` | `task mobile:check`. | [`mobile/README.md`](../../mobile/README.md) |
| `Test / Mobile E2E` | `task mobile:test-integration` on an Android emulator with public API and seed. | [`mobile/README.md`](../../mobile/README.md) |
| `Test / E2E` | `task e2e:run`: build, readiness, Playwright, teardown. | [`e2e/README.md`](../../e2e/README.md) |
| `Test / Bootstrap` | `task e2e:bootstrap`: empty volume, `task setup`, DB restart, `task dev`. | [`e2e/bootstrap/README.md`](../../e2e/bootstrap/README.md) |
| `Test / Routing` | `task e2e:routing`: Dev Container Traefik host, `/api`, and `/images` connectivity. | [`e2e/routing/README.md`](../../e2e/routing/README.md) |
| `Build` | `pnpm build` for Web and `task server:build` for Go. | This file |
| `Docker / <target>` | `task docker:build:*`, then web/node smoke tests. | [`infra/docker/README.md`](../../infra/docker/README.md) |
| `Summary` | Final aggregation of every job result. | This file |

The branch ruleset requires only final aggregation job **`Summary`** (shown as `CI / Summary`). Intermediate jobs can be skipped by filters; `Summary` treats `skipped` as success.

## Triggers and modes

| Trigger | Host CI | Docker |
| --- | --- | --- |
| `pull_request` to main / `push` to main | Only matching jobs through path filters. | Representatives of changed roles only; all targets when `docker_core` changes. |
| `schedule` (daily at 03:00 UTC) | Only `Test / Bootstrap`. | Every target (nightly full). |
| `workflow_dispatch` | Every job. | Select `verify` (representatives) or `full` (all targets) through `docker_mode`. |

Nightly full builds find cross-service drift that filters cannot catch. Host CI does not run nightly except **Test / Bootstrap**, which monitors rarely changed paths such as `.devcontainer/**`.

## Path filters

`Detect changes` uses [dorny/paths-filter](https://github.com/dorny/paths-filter); `scripts/ci-plan-jobs.sh` turns the result into job flags and the Docker matrix.

For **every job**, changes to `.github/workflows/ci.yml` and `scripts/ci-plan-jobs.sh` force the job to run so CI changes cannot escape validation. The heavyweight filters exclude Markdown (`**/*.md`), avoiding checks triggered by README-only changes; `Lint and Format` deliberately includes it. Outside those shared rules, the main filters are:

| Job | Watched paths |
| --- | --- |
| `Lint and Format` | Every path (including documentation); oxfmt ignores unsupported and configured-ignored files. |
| `Check` | `apps/**`, `locales/**`, `packages/**`, `e2e/**`, `server/**`, `db/**`, `proto/**`, generator config, and package / lock / turbo config |
| `Lint / Go` | `server/**` |
| `Test / Go` | `server/**`, `db/**`, `proto/**`, and generator config |
| `Test / TypeScript` | apps, locales, packages, package / lock / turbo config |
| `Test / DB Migrations` | `db/**`, `sqlc.yaml` |
| `Test / Mobile` | `mobile/**`, `Taskfile.yaml` |
| `Test / Mobile E2E` | mobile, E2E lifecycle scripts and page fixtures, domain proto, server, migrations/seeds, Taskfile, storage init |
| `Test / E2E` | E2E except routing, web apps, packages, server, db, and build inputs |
| `Test / Bootstrap` | Dev Container, db, bootstrap, apps, packages, server, Taskfile, build inputs, storage init |
| `Test / Routing` | `.devcontainer/**`, `e2e/routing/**` |
| `Build` | apps, packages, server, and build inputs |
| `Docker` | The role mapping in [Docker CI execution strategy](../../infra/docker/README.md#docker-ci-execution-strategy) |

The heavyweight-job exclusion is implemented as:

```yaml
predicate-quantifier: "some-with-excludes"
filters: |
  docs_excluded: &docs_excluded
    - '!**/*.md'
  format:
    - '**'
  check:
    - *docs_excluded
    - 'apps/**'
    …
```

**`predicate-quantifier: "some-with-excludes"` is required.** Default `some` treats the negative pattern as merely another choice, so it does not exclude Markdown. `some-with-excludes` requires at least one positive match and no negative matches. Define `&docs_excluded` once and include `*docs_excluded` in every heavyweight filter; the negative-only `docs_excluded` output is always false and is not read by `scripts/ci-plan-jobs.sh`. `format` intentionally omits it, so documentation-only pull requests receive only the lightweight `Lint and Format` job.

For `pull_request`, paths-filter obtains changed files through the GitHub API, so shallow history is sufficient. For `push`, it diffs `github.event.before`..HEAD locally, requiring the base commit. `Detect changes` sets `persist-credentials: false`, so the fallback fetch cannot authenticate; on pushes, use `fetch-depth: 0` to provide the base locally:

```yaml
fetch-depth: ${{ github.event_name == 'push' && '0' || '1' }}
```

Quotes around `'0'` are required: GitHub expressions treat bare `0` as falsy, which would turn the push result into `1` and reproduce the failure.

Separate Go, TypeScript, migration, mobile, mobile E2E, E2E, bootstrap, and routing jobs prevent unrelated toolchain setup for a focused PR; `Summary` keeps the required-check count unchanged. `sqlc diff` reads schema and query files and needs no live database, so it remains in `Check`.

`Validate / buf Generated Diff` runs `buf generate`, then compares `server/gen/**` and `packages/api-client/src/gen/**` against the committed tree. `buf.gen.yaml` sets `clean: true` so stale output is visible; when it fails, run `task gen` and commit the result. CI stages before comparing so untracked generated files are included.

## Lint, migrations, and Docker

`Lint / Go` is independent from `Test / Go` so static-analysis results arrive before Testcontainers tests, and front-end-only PRs do not run it. Its rules and version are [`server/.golangci.yml`](../../server/.golangci.yml) and `GOLANGCI_LINT_VERSION` in `ci.yml`; reproduce it with `task server:lint`.

`Test / DB Migrations` first checks that the PR only adds files under `db/migrations/` — an applied migration is immutable, so a modified, renamed, or deleted one fails the job before Postgres is touched. It then runs against its own Postgres service and must succeed through `migrate up`, `migrate down -all`, and another `migrate up`; any failure, including a dirty database, makes `Summary` fail. This is the one job whose checkout uses `fetch-depth: 0`, because the guard diffs against `origin/main`.

`Docker / <target>` executes the matrix from `scripts/ci-plan-jobs.sh` with the same `task docker:build:web|api|batch|node` commands used locally, followed by `task docker:smoke:web` or `task docker:smoke:node` where applicable. See [`infra/docker/README.md`](../../infra/docker/README.md) for role mapping, build conventions, local verification, and Docker triage.

## Failure triage

1. Identify the failing `CI` job. A failed **`Summary`** means a dependency is `failure` or `cancelled`; its log reports `Job failed: <name>`.
2. Reproduce locally:

   | Job | Local command |
   | --- | --- |
   | `Lint and Format` | `pnpm check` |
   | `Check` | `pnpm locales:check`, `sqlc diff`, `buf generate` / generated diff, package build, `pnpm typegen`, and `pnpm typecheck` |
   | `Test / Go` | `task server:test-short` then `task server:test` |
   | `Test / TypeScript` | `pnpm build --filter "./packages/*"` then `pnpm test` |
   | `Test / DB Migrations` | `task db:reset`; use `task db:rollback` for down only. An append-only failure is not reproduced locally: restore the migration and add a new one instead |
   | `Test / Mobile` | `task mobile:check` |
   | `Test / Mobile E2E` | `task mobile:e2e` |
   | `Test / E2E` | `task e2e` |
   | `Test / Bootstrap` | `task e2e:bootstrap` (`BOOTSTRAP_SKIP_DEV=1` if `task dev` cannot stop) |
   | `Test / Routing` | `task e2e:routing` |
   | `Build` | `pnpm build` / `task server:build` |
   | `Docker / <target>` | The exact CI `task docker:build:…` line, or `task docker:verify` |

3. For CI-only failures, consider runner architecture / Buildx differences, stale caches (rerun CI or use local `docker builder prune`), and missed path filters (use `workflow_dispatch`, Docker `full`, or nightly results).

## CI change checklist

- [ ] Added or renamed jobs in `Summary` `needs` and aggregation loop (environment and display name)
- [ ] Updated `scripts/ci-plan-jobs.sh` flags, output, and `workflow_dispatch` branch for a new path filter
- [ ] Added `- *docs_excluded` to every new heavyweight filter
- [ ] Updated the Jobs and Path filters tables in this document
- [ ] Confirmed that a `Detect changes` checkout change still resolves the push base (the `fetch-depth` / `persist-credentials` combination)
- [ ] Confirmed that `Summary` remains the required branch-ruleset check after changing a displayed job name
- [ ] Updated `infra/docker/Taskfile.yaml` `verify:full` and the full Docker matrix in `scripts/ci-plan-jobs.sh` when adding a Docker target
