# GitHub Actions workflows

| Workflow | File | Purpose |
| --- | --- | --- |
| `CI` | [`ci.yml`](./ci.yml) | Validation jobs described below. |
| `Skills Update` | [`skills-update.yml`](./skills-update.yml) | Weekly pull requests that update agent skills. |
| `Organize issues` | [`organize-issues.yml`](./organize-issues.yml) | Issue-maintenance automation. |
| `Review` | [`review.yml`](./review.yml) | Review-support automation. |
| `Regenerate` | [`regenerate.yml`](./regenerate.yml) | Stacked pull requests that regenerate output for a generator version bump. |

## Organize issues

[`organize-issues.yml`](./organize-issues.yml), named `Organize issues`, is the home for Issue-maintenance jobs. Add work by job; it uses `actions/github-script` and does not check out the repository.

| Displayed job | Purpose |
| --- | --- |
| `Close completed epics` | Close an `epic` Issue as `completed` when all native sub-issues are closed. |

`Close completed epics` is triggered by a closed Issue and manual `workflow_dispatch` (which scans open `epic` Issues if no number is supplied). It considers only `epic` parents with at least one sub-issue, walks nested Epic ancestors in one run, and is serialized to avoid missed simultaneous closures. A `GITHUB_TOKEN` close does not trigger another run.

## Review

[`review.yml`](./review.yml), named `Review`, is the home for review-support jobs. Add work by job.

| Displayed job | Purpose |
| --- | --- |
| `Label review size` | Give a pull request one `size/*` label computed from its diff. |
| `Label AI assistance` | Give a pull request the `ai-assisted` label when its commits disclose a coding agent. |

Both jobs are triggered by `pull_request_target`, whose types are the union of what they need: `opened`, `ready_for_review`, and `synchronize`. `pull_request` cannot be used: a fork's `GITHUB_TOKEN` is read-only and could not add a label. An `opened` event for a draft is skipped by both, so a pull request opened as a draft is labelled when it is marked ready and one opened ready is labelled immediately.

### Review size

A diff's line count says little about how much review a pull request needs: a lock-file refresh and a rewrite of the session cookie handling can both read as `+400 −120`. The label states the expected review load, so the queue can be sorted by cost and an outlier is visible as a candidate to split. It describes a pull request; it does not gate anything, and it is not recomputed on `synchronize` — the label is a snapshot from the moment review was requested.

#### The score

[`scripts/pr-size.ts`](../../scripts/pr-size.ts) reads a unified diff on standard input and prints the score and the bucket, so a local run and the workflow agree on the number by construction:

```bash
git diff origin/main...HEAD | node scripts/pr-size.ts
```

```
score = Σ over changed files ( coefficient(path) × significant_lines(file) )
```

`significant_lines` counts added and removed lines together, skipping the lines that carry no information: blank lines, lines whose trimmed content is only delimiters (`{`, `}`, `(`, `)`, `[`, `]`, `,`, `;`, and combinations such as `});`), and lines that hold only a JSX tag (`</Card>`, `<Separator />`, `<CardHeader>`, `<>`, `</>`, and the `>` / `/>` that closes a tag the formatter broke across lines). A closing tag is the JSX brace, and dropping it here is truer than discounting a whole language for it.

`coefficient(path)` weights a line by what it costs to read. Generated and vendored output is already excluded from review by `.gitattributes` and `.coderabbit.yaml`, so it weighs nothing; the scorer reads those paths from `.gitattributes` rather than listing them a second time. The first matching row wins, so a more specific kind sits above the kind that would otherwise swallow it.

| Path or kind | Coefficient |
| --- | --- |
| Generated and vendored (`linguist-generated` / `linguist-vendored` in `.gitattributes`), `pnpm-lock.yaml`, `mobile/pubspec.lock`, `skills-lock.json`, `.devcontainer/devcontainer-lock.json` | 0 |
| Fixtures, test data, snapshots, `locales/*.json` | 0.2 |
| Markdown and other documentation | 0.3 |
| Tests (`*_test.go`, `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `*_test.dart`, `e2e/**`, `mobile/test/**`, `mobile/integration_test/**`) | 0.5 |
| Workflows and configuration (YAML, JSON, TOML, XML, and the mobile platform property files) | 0.7 |
| React components (`*.tsx`) | 0.9 |
| Application and package source (Go, TypeScript, Dart), and every path the table does not name | 1.0 |
| Contracts (`proto/**`, `db/migrations/**`, `db/query/**`) | 1.5 |

`*.tsx` is discounted for what the tag filter cannot reach: the formatter puts one attribute per line, so a component's props arrive as attribute-only and opening-tag lines, each cheaper to read than a line of logic. It is not discounted for being React — the hazards that make a component hard to review (a props-to-state Effect, the Server/Client boundary, `use cache` placement) sit in a handful of lines and do not grow with the size of the tree, which is what the one-bucket raise in `skills/create-pr` is for.

| Bucket    | Score      |
| --------- | ---------- |
| `size/xs` | ≤ 60       |
| `size/s`  | ≤ 200      |
| `size/m`  | ≤ 600      |
| `size/l`  | ≤ 1600     |
| `size/xl` | above 1600 |

Coefficients and thresholds live in `scripts/pr-size.ts`; its classification and bucket assignment are covered by `scripts/pr-size.test.ts`. `scripts/` sits outside the pnpm workspace, so Vitest does not reach it: the tests run under `node --test` through `pnpm test:scripts`, which `pnpm preflight` and the `Test / TypeScript` job both call.

#### The job

`Label review size` skips `synchronize` on top of the shared draft check, which is what makes the label a snapshot rather than a running score.

The job holds `contents: read` and `pull-requests: write`, and it never checks out the head branch — `pull_request_target` resolves to the base commit, so the scorer that runs is the one that was reviewed and merged. A job's `permissions` block replaces the workflow's `permissions: {}` rather than adding to it, so the read the checkout needs has to be spelled out in the job. It reads per-file patches from `GET /repos/{owner}/{repo}/pulls/{number}/files` and pipes them to that scorer; where the API omits a patch (a binary or oversized file), it stands in one significant line for each addition and deletion the API counted.

A pull request that already carries a `size/*` label is left alone and the run log says so. A label the author set — an agent following `skills/create-pr`, or a human who has judged the review load — wins over the mechanical score.

### AI assistance

Every commit written with the help of a coding agent carries an `Assisted-by:` trailer — that trailer, and not the label, is the disclosure this repository requires, and `AGENTS.md` is where the requirement is stated. A trailer is only visible once the commits are open, though, so from the pull request list and from the notification a reviewer acts on, an agent-written pull request looks exactly like a hand-written one. The two do not want the same reading: an agent's diff is fluent everywhere, including the places it did not understand, so the parts worth doubting are not the parts that look rough. `Label AI assistance` carries the disclosure onto the pull request as the `ai-assisted` label, where it is visible before the review starts and can be filtered and counted afterwards.

The job reads the commit messages from `GET /repos/{owner}/{repo}/pulls/{number}/commits` and treats the pull request as agent-assisted when any of them carries an `Assisted-by:` trailer, matched case-insensitively as Git itself matches a trailer token. It holds `pull-requests: write` and nothing else, and checks nothing out.

It runs on `synchronize` as well as `opened` and `ready_for_review`, because the label tracks the commits rather than the moment review was requested: an agent commit pushed onto a hand-written branch has to be caught. For the same reason the trailers are the only source of truth, so the job removes the label as readily as it adds it — a branch that lost its agent commits to a force-push loses the label on the next event.

The label discloses and nothing more. It fails no check and blocks no merge, and there is one label rather than one per agent: the trailer already records the agent and the model, and a label per tool would multiply with every tool anyone uses.

`skills/create-pr` needs no step for this. The label is derived from the trailer the skill already writes, so an agent cannot ship an unlabelled pull request by forgetting one.

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
- Flutter SDK setup for the two mobile jobs: [`scripts/setup-flutter.sh`](../../scripts/setup-flutter.sh)

[`infra/docker/README.md`](../../infra/docker/README.md) is authoritative for Docker image placement, build steps, and Docker-specific triage. This document covers only how the `Docker` job is started by CI.

## Jobs

| Displayed job | Contents | Details |
| --- | --- | --- |
| `Detect changes` | Evaluate path filters and select jobs and Docker matrix entries. | This file |
| `Lint and Format` | `pnpm check` across every file type that oxfmt supports. | [`AGENTS.md`](../../AGENTS.md) |
| `Check` | Locale-catalog, `sqlc`, and buf-generated drift; package builds; `pnpm typegen`, literal-`<svg>` grep, and `pnpm typecheck`. | [`AGENTS.md`](../../AGENTS.md) |
| `Lint / Go` | `golangci-lint run ./...` in `server/`. | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / Go` | `go test ./...` in `server/`. | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / TypeScript` | `pnpm test` after package builds, then `pnpm test:scripts` for the `node --test` suites under `scripts/`. | [`apps/AGENTS.md`](../../apps/AGENTS.md) |
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

Nightly full builds find cross-service drift that filters cannot catch. Host CI does not run nightly except **Test / Bootstrap**, which monitors rarely changed paths such as `compose.yaml`.

## Path filters

`Detect changes` uses [dorny/paths-filter](https://github.com/dorny/paths-filter); `scripts/ci-plan-jobs.sh` turns the result into job flags and the Docker matrix.

For **every job**, changes to `.github/workflows/ci.yml` and `scripts/ci-plan-jobs.sh` force the job to run so CI changes cannot escape validation. The heavyweight filters exclude Markdown (`**/*.md`), avoiding checks triggered by README-only changes; `Lint and Format` deliberately includes it. Outside those shared rules, the main filters are:

| Job | Watched paths |
| --- | --- |
| `Lint and Format` | Every path (including documentation); oxfmt ignores unsupported and configured-ignored files. |
| `Check` | `apps/**`, `locales/**`, `packages/**`, `e2e/**`, `server/**`, `db/**`, `proto/**`, generator config, and package / lock / turbo config |
| `Lint / Go` | `server/**` |
| `Test / Go` | `server/**`, `db/**`, `proto/**`, and generator config |
| `Test / TypeScript` | apps, locales, packages, `scripts/*.ts`, package / lock / turbo config |
| `Test / DB Migrations` | `db/**`, `sqlc.yaml` |
| `Test / Mobile` | `mobile/**`, `Taskfile.yaml`, `scripts/setup-flutter.sh` |
| `Test / Mobile E2E` | mobile, E2E lifecycle scripts and page fixtures, domain proto, server, migrations/seeds, Taskfile, storage init, `scripts/setup-flutter.sh` |
| `Test / E2E` | E2E except routing, web apps, email-renderer, packages, server, db, and build inputs |
| `Test / Bootstrap` | `compose.yaml`, db, bootstrap, apps, packages, server, Taskfile, build inputs, storage init |
| `Test / Routing` | `compose.yaml`, `.devcontainer/**`, `e2e/routing/**` |
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

`Test / DB Migrations` first checks that the PR only adds files under `db/migrations/` — an applied migration is immutable, so a modified, renamed, or deleted one fails the job before Postgres is touched. It then runs against its own Postgres service and must succeed through `migrate up`, `migrate down -all`, and another `migrate up`; any failure, including a dirty database, makes `Summary` fail. Because the guard diffs against `origin/main`, this job's checkout uses `fetch-depth: 0` on every event, where `Detect changes` fetches full history only on `push`.

`Docker / <target>` executes the matrix from `scripts/ci-plan-jobs.sh` with the same `task docker:build:web|api|batch|node` commands used locally, followed by `task docker:smoke:web` or `task docker:smoke:node` where applicable. See [`infra/docker/README.md`](../../infra/docker/README.md) for role mapping, build conventions, local verification, and Docker triage.

## Flutter SDK setup

`Test / Mobile` and `Test / Mobile E2E` install Flutter through [`scripts/setup-flutter.sh`](../../scripts/setup-flutter.sh), which clones the tag named by `FLUTTER_VERSION` — the `env` block of [`ci.yml`](./ci.yml) is the single source of truth for the version — and bootstraps the Dart SDK. The script takes its destination, its credentials, and the `PATH` entry from the environment, so it installs the same pinned SDK on a workstation as it does on a runner; the jobs give it `github.token` and let it default to `RUNNER_TEMP` and `GITHUB_PATH`.

In CI the clone is authenticated with `github.token`. github.com answers an unauthenticated clone from a shared runner address with a credential prompt often enough to matter (`fatal: could not read Username for 'https://github.com'`), and the job then fails within seconds; an authenticated request is attributed to this repository instead. The token is passed as an `http.<url>.extraheader` on the `git` invocation and not with `git clone -c`, which would persist the header in the cloned repository's own config. On top of that the script retries the clone three times with a short backoff, deleting the partial destination between attempts.

## Failure triage

1. Identify the failing `CI` job. A failed **`Summary`** means a dependency is `failure` or `cancelled`; its log reports `Job failed: <name>`.
2. Reproduce locally:

   | Job | Local command |
   | --- | --- |
   | `Lint and Format` | `pnpm check` |
   | `Check` | `pnpm locales:check`, `sqlc diff`, `buf generate` / generated diff, package build, `pnpm typegen`, and `pnpm typecheck` |
   | `Test / Go` | `task server:test-short` then `task server:test` |
   | `Test / TypeScript` | `pnpm build --filter "./packages/*"`, then `pnpm test` and `pnpm test:scripts` |
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
