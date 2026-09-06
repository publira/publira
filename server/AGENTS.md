# Server Agent Guide

Conventions for the Go backend module `github.com/publira/publira/server`. Prefer this file for server work; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth for repo-wide agent policy. Database schema rules: [`db/AGENTS.md`](../db/AGENTS.md).

## Layout

| Path | Role |
| --- | --- |
| `cmd/` | Thin entrypoints only (`api-server`, `admin-api-server`, `platform-api-server`, image servers, `outbox-worker`, and `batch` for every batch job) |
| `api/` | ConnectRPC handlers (admin / platform / public) |
| `internal/` | Shared business logic, middleware, storage, auth |
| `internal/db/` | Hand-written PostgreSQL integration tests for the schema in `db/migrations/` and the queries in `db/query/` |
| `internal/db/gen/` | **sqlc-generated** — do not hand-edit |
| `internal/proto/gen/` | **buf-generated** protobuf / Connect stubs — do not hand-edit |
| `config/` | Runtime config |
| `internal/testutil/` | Shared test helpers (Testcontainers PostgreSQL, Snapshot/Restore) |

## Implementation rules

1. **Schema-first**: change API/DB contracts before handlers.
   - API: edit `proto/`, then `task gen` (repo root).
   - DB: add a migration under `db/migrations/` and/or edit `db/query/`, then `task gen`. `db/migrations/` is append-only; the policy is in `db/AGENTS.md`.
   - List RPC pagination is cursor-based and shared across RPCs: field names, token format, sort key rules, and the `pagination` helper are in [`proto/README.md`](../proto/README.md).
2. Keep `cmd/` thin; put real logic in `api/` / `internal/`.
3. **Every batch job is a subcommand of `cmd/batch`**, one binary and one image, selected by the first argument. A new batch is a new entry in that command's subcommand table, never a new `cmd/` directory: per-batch directories multiply the Docker matrix and the registrations in `infra/docker/Taskfile.yaml` and `scripts/ci-plan-jobs.sh`. Keep each subcommand's own lifecycle — `batch publish-episodes` is a ticker, the rest are one-shot — and resolve `service.name` as `publira-<subcommand>`.
4. `batch publish-episodes` is a ticker batch, not a job queue. The Outbox worker (`cmd/outbox-worker`) is a long-lived River process, process-separated from the APIs.
5. Never commit hand-edits to generated output. Regenerate instead. Every generator in this module writes into a `gen/` directory under the `internal/` package it belongs to — buf into `internal/proto/gen/`, sqlc into `internal/db/gen/`, the locale registry into `internal/locale/gen/` — so no file outside one is generated and the rule needs no list of file names.

## UI locale: no default

`internal/locale` has no `Default`, and adding one back under any name is forbidden. `locale.Resolve` reports `ErrUnresolved` for a stored value naming no supported code, and every caller fails on it: an RPC with `internalError` (`CodeInternal`), the invitation job with `Permanent`. Never with another language — a wrong locale shows the reader a page they cannot read and hides the fault that produced it.

The contrast with `tenanttz.Default` is deliberate: a timestamp rendered in the wrong zone is off by hours and still legible, so the time zone keeps its last-resort constant.

Each path takes the locale from the row it is about — `tenants.default_locale` for anything tenant-facing, the job payload for work that has no such row. `platformconfig.DefaultLocale` answers the platform console's own display language and stands in for no other row; tenant creation takes the locale from its request, and `CreateInitialUser` from the operator's choice on the setup screen.

The one empty answer is `CheckSetupStatus` on a platform whose settings row does not exist yet: nothing has been saved, and the setup screen negotiates its first language from `Accept-Language`. A row that exists and names no supported locale is not that state and fails like every other read. Resolve the locale before anything that fails retriably, too — the invitation job does it before the SMTP settings, so an outage cannot disguise a locale no retry can fix.

No lint covers this. The read paths are in `api/*/`, `internal/outbox/`, and `internal/platformconfig/`; the frontend half of the same rule is the **UI locale** section of [`apps/AGENTS.md`](../apps/AGENTS.md).

## A process resolves its own role variable, and no one else's

Each server and worker connects with the dedicated PostgreSQL login named for it, read from its own `PUBLIRA_*_DB_URL` and falling back to that role's development URL. `PUBLIRA_DB_URL` is not a link in that chain: it is the migration tooling's connection and the superuser locally, so a process that falls back to it runs with more privilege than the role it was given, in exactly the deployment where the variable was forgotten. Failing to authenticate on a development password is the better outcome, and it is what every server already does.

Neither may one process's chain reach into another's variable. A shared fallback looks harmless while both processes happen to run on the same connection and turns into a silent role change the day either one is repointed. The `cmd/batch` subcommands are the one place a chain runs several variables deep, and it stays inside the batches' own names before ending at `PUBLIRA_DB_URL`.

Adding a role means adding it to `db/seeds/baseline/000_rls_bypass_role.sql` with the grants that process needs, pointing local development at it (`scripts/dev-env/lib.sh`, `e2e/scripts/lib.sh`, `e2e/bootstrap/scripts/lib.sh`), and updating the **Database users** table in [README.md](README.md). A role that only production uses is a role whose grants are first exercised on a deploy.

No lint covers this — the variable names are strings in each `cmd/` entrypoint.

## Stored objects must be named by a row the sweep knows

`batch purge-orphan-images` treats the database as the authority over the bucket: it walks every object under `tenants/` and deletes the ones no `*_image_variants` row names. A new upload path that writes under that prefix without a row in one of those tables therefore has its objects deleted a day later, silently.

So a new kind of stored object either records its key in one of the existing `*_image_variants` tables, or brings its own table and a clause in `ListReferencedObjectKeys` (`db/query/storage.sql`) — never a bare `Upload` with the key kept somewhere else. Where the row points at an image an entity elects (an icon, an eye catch), add the matching `DeleteUnreferenced*Images` query too, so a replaced image's row stops protecting its objects.

No lint covers this. The reclamation logic is `internal/orphanimages`, documented in [`cmd/batch/README.md`](cmd/batch/README.md).

## Verification after Go changes

Run verification from the **repository root** unless noted. Prefer Task targets so commands stay consistent with CI.

### Default checklist (almost always)

| Step | Command | When |
| --- | --- | --- |
| Static analysis + formatting | `task server:lint` | After any `server/` change; CI gates on it (`Lint / Go`) |
| Unit / package tests (fast) | `task server:test-short` | After any non-trivial `server/` change |
| Full Go tests (CI parity) | `task server:test` | Before finishing; includes Testcontainers DB tests (needs Docker) |
| Build binaries | `task server:build` | When changing `cmd/` or wiring that might break compile |

Equivalent without Task (from `server/`):

```bash
golangci-lint run ./...
go test -short ./...
go test ./...
go build -o bin/ ./cmd/...
```

### Lint (golangci-lint)

Rules live in [`.golangci.yml`](.golangci.yml); the enabled set is golangci-lint's own `standard` default (`errcheck`, `govet`, `ineffassign`, `staticcheck`, `unused`), plus the `gofmt` formatter. `Lint / Go` in CI runs the same file and the same pinned version, so a clean `task server:lint` means a clean CI job.

- **Formatting is part of the same gate.** `golangci-lint run` reports a `gofmt`-dirty file as `File is not properly formatted (gofmt)`, so `task server:lint` (and therefore `Lint / Go`) fails on it — there is no separate formatting job. To fix only formatting, run `golangci-lint fmt ./...` from `server/` (`gofmt -w` on individual files works too); it rewrites files in place and reports nothing.

- Generated code is excluded by its canonical `Code generated … DO NOT EDIT.` header, not by path. Leave it that way rather than listing `gen/` directories in `exclusions.paths`: the header covers a new generator's output the day it is added, while a path list has to be extended by hand and stops matching without failing. Keep `exclusions.generated` at `strict`; `lax` matches "do not edit" anywhere in a file's leading comments and silently skips hand-written files that say so in prose.
- **Fix the finding rather than suppress it.** The one standing exception is `errcheck` on deferred cleanup, where the error is unactionable and `defer` has no statement form to discard it:

  ```go
  defer tx.Rollback()  //nolint:errcheck
  defer db.Close()     //nolint:errcheck
  ```

  Outside `defer`, discard explicitly with `_ = conn.Close()` instead of a directive.

- Suppressing anything else needs a reason on the line (`//nolint:staticcheck // …`) or, for a whole rule, a comment in `.golangci.yml`. Bare directives beyond the `defer` convention above, and blanket `linters.disable` entries, do not belong here.
- Adding or removing a linter or formatter is its own change, separate from the work that surfaced the need. The formatter set is plain `gofmt`; swapping in a stricter one (`gofumpt`, `goimports`, `golines`) reformats the whole module and needs its own discussion.
- Version bumps: `GOLANGCI_LINT_VERSION` in [`.devcontainer/Dockerfile`](../.devcontainer/Dockerfile) and [`ci.yml`](../.github/workflows/ci.yml) must move together (Renovate manages both).

### When codegen inputs change

If you touched `proto/**`, `db/migrations/**`, `db/query/**`, or `sqlc.yaml` / `buf.gen.yaml`:

```bash
task gen          # sqlc generate + buf generate
sqlc diff         # must be clean (CI runs this)
```

Then re-run `task server:test-short` (or full `task server:test`).

### When Go module deps change

```bash
task server:tidy  # go mod tidy
```

Ensure `go.mod` / `go.sum` stay consistent; do not leave unused or missing requires.

### Optional quick compile check

```bash
# from server/
go test -c -o /dev/null ./...
# or package-scoped while iterating:
go test ./api/adminapi/ -count=1
```

## Testing notes

- **Unit tests**: prefer `sqlmock` for DB-facing logic when a real Postgres is unnecessary.
- **Integration tests**: use `internal/testutil` (Testcontainers PostgreSQL). They skip when Docker is unavailable or when `-short` is set.
- Prefer adding focused package tests next to the code under test (`*_test.go` in the same package or `_test` package as existing files do).
- Do not rely on a shared long-lived local DB for default unit tests; use mocks or Testcontainers helpers.

## Out of scope for this file

Env vars, storage backends, JWT details, and operator runbooks live in [README.md](README.md). Keep this guide to agent conventions and verification only.
