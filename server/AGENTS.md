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
   - DB: edit `db/migrations/` baseline and/or `db/query/`, then `task gen`. Early-stage migration policy is in `db/AGENTS.md` (fold into `0000…baseline`, do not add new migration files).
2. Keep `cmd/` thin; put real logic in `api/` / `internal/`.
3. Batches are one-shot processes (run once and exit), not long-lived daemons.
4. Never commit hand-edits under `gen/` or `internal/db/`. Regenerate instead.

## Verification after Go changes

Run verification from the **repository root** unless noted. Prefer Task targets so commands stay consistent with CI.

### Default checklist (almost always)

| Step | Command | When |
| --- | --- | --- |
| Unit / package tests (fast) | `task server:test-short` | After any non-trivial `server/` change |
| Full Go tests (CI parity) | `task server:test` | Before finishing; includes Testcontainers DB tests (needs Docker) |
| Build binaries | `task server:build` | When changing `cmd/` or wiring that might break compile |

Equivalent without Task (from `server/`):

```bash
go test -short ./...
go test ./...
go build -o bin/ ./cmd/...
```

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
