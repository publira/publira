# Database Agent Guide

Conventions for `db/` (migrations, sqlc queries, seeds). Prefer this file for schema work; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth for repo-wide agent policy.

## Early-stage migrations: keep a single baseline

This project is still in **early implementation**. Schema changes must be folded into the existing baseline migration instead of adding new versioned migration files.

### Do

- Edit `migrations/00000000000000_baseline.up.sql` (and the matching `.down.sql` when needed) so the full desired schema lives in that single baseline.
- After changing schema SQL used by sqlc, regenerate from the repo root with `task gen`, then confirm `sqlc diff` is clean. See [`server/AGENTS.md`](../server/AGENTS.md) for the full Go verification checklist.
- Rebuild local DB from scratch when the baseline changes: `task db:reset` (or drop + migrate + seed).

### Do not

- Do **not** add new files under `migrations/` such as `00000000000001_*.sql` via `task db:create` / `migrate create` during this phase.
- Do **not** invent incremental up/down chains for greenfield schema work; keep history flat until production-facing migration history is intentionally introduced.

### When this changes

Once the schema is treated as production-stable and real rollout history matters, stop rewriting the baseline and start appending numbered migrations. Until that decision is explicit, **baseline-only** remains the rule.

## Layout (quick map)

| Path | Role |
| --- | --- |
| `migrations/` | golang-migrate DDL (currently only `00000000000000_baseline`) |
| `query/` | sqlc query sources |
| `seeds/` | Seed SQL; `baseline/` is environment-common, `dev/` is local data |

Migration vs seed responsibilities: see `seeds/README.md` and the root `README.md` database section.

## Targeting another database

`task db:*` points at the Dev Container `db` service by default. Export `PUBLIRA_DB_URL` to run the same tasks against an ephemeral database — that is how the bootstrap check (`e2e/bootstrap/`) drives `task db:setup` against its own Compose project. Keep the default in `Taskfile.yaml` as the `db` hostname; do not hardcode a second URL.
