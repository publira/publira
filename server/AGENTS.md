# Server Agent Guide

Conventions for the Go backend module `github.com/publira/publira/server`. Prefer this file for server work; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth for repo-wide agent policy. Database schema rules: [`db/AGENTS.md`](../db/AGENTS.md).

## Layout

| Path | Role |
| --- | --- |
| `cmd/` | Thin entrypoints only (`api-server`, `admin-api-server`, `platform-api-server`, image servers, batches) |
| `api/` | ConnectRPC handlers (admin / platform / public) |
| `internal/` | Shared business logic, middleware, storage, auth |
| `internal/db/` | **sqlc-generated** — do not hand-edit |
| `gen/` | **buf-generated** protobuf / Connect stubs — do not hand-edit |
| `config/` | Runtime config |
| `internal/testutil/` | Shared test helpers (Testcontainers PostgreSQL, Snapshot/Restore) |

## Implementation rules

1. **Schema-first**: change API/DB contracts before handlers.
   - API: edit `proto/`, then `task gen` (repo root).
   - DB: edit `db/migrations/` baseline and/or `db/query/`, then `task gen`. Early-stage migration policy is in `db/AGENTS.md` (fold into `00000000000000_baseline`, do not add new migration files).
   - List RPC pagination is cursor-based and shared across RPCs: field names, token format, sort key rules, and the `pagination` helper are in [`proto/README.md`](../proto/README.md).
2. Keep `cmd/` thin; put real logic in `api/` / `internal/`.
3. Batches are one-shot processes (run once and exit), not long-lived daemons.
4. Never commit hand-edits under `gen/` or `internal/db/`. Regenerate instead.

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

- Generated code is excluded by its canonical `Code generated … DO NOT EDIT.` header, not by path. Do not add `gen/` or `internal/db/` to `exclusions.paths` — `internal/db/` also holds hand-written `*_integration_test.go` files that must stay linted. Keep `exclusions.generated` at `strict`; `lax` matches "do not edit" anywhere in a file's leading comments and silently skips hand-written files that say so in prose.
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
