# Database Agent Guide

Conventions for `db/` (migrations, sqlc queries, seeds). Prefer this file for schema work; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth for repo-wide agent policy.

## Migrations are append-only

`migrations/` is the golang-migrate history. A schema change is always a **new** migration; the files already there are never edited, renamed, or deleted.

Rewriting an applied migration changes nothing in a database that already recorded that version in `schema_migrations` — golang-migrate will not run the version a second time. The edit reaches only databases built from scratch afterwards, so environments silently drift apart. Correct a mistake by stacking another migration on top of it.

The `Test / DB Migrations` CI job enforces this: it diffs `migrations/` against `origin/main` and fails when any change there is not a plain addition, so a modified, renamed, or deleted migration cannot merge.

### Adding a migration

- Create the pair with `task db:create NAME=<name>`. It runs `migrate create -ext sql -dir ./migrations -tz UTC`, which names both files with a 14-digit UTC timestamp.
- Keep the numbering 14 digits wide and zero-padded. golang-migrate orders versions numerically while sqlc reads the directory in lexicographic order, and equal width is what keeps those two orders the same.
- Write a `down` that actually undoes the `up`. The `Test / DB Migrations` CI job runs `up` → `down -all` → `up` against an empty database, so a broken `down` fails the build.
- Give `CREATE INDEX CONCURRENTLY` a migration of its own. The golang-migrate postgres driver runs each file in a transaction, and that statement cannot execute inside one.
- After changing schema SQL that sqlc reads, regenerate from the repo root with `task gen` and confirm `sqlc diff` is clean. See [`server/AGENTS.md`](../server/AGENTS.md) for the full Go verification checklist.

### The initial schema

Versions `00000000000001`–`00000000000008` hold the initial schema, one migration per domain: `platform`, `identity`, `catalog`, `pages`, `notifications`, `commerce`, `engagement`, `outbox`. Each is self-contained — its own tables, constraints, indexes, foreign keys, and RLS policies — with the foreign keys that close a cycle inside the domain applied at the end of the file. Cross-domain foreign keys always point backwards, so the numbering doubles as the dependency order.

These sequence numbers never collide with later timestamps: `00000000000008` is far smaller than any 14-digit UTC timestamp, so the history stays monotonic.

### Rebuilding a local database

`migrate up` cannot move a database whose `schema_migrations` records a version that no longer exists in `migrations/`, and it cannot apply a migration whose objects are already there. Recreate the database with `task db:reset` instead of patching it by hand.

## Layout (quick map)

| Path | Role |
| --- | --- |
| `migrations/` | golang-migrate DDL, append-only |
| `query/` | sqlc query sources |
| `seeds/` | Seed SQL; `baseline/` is environment-common, `dev/` is local data |

Migration vs seed responsibilities: see `seeds/README.md` and the root `README.md` database section.

## Targeting another database

`task db:*` points at the Dev Container `db` service by default. Export `PUBLIRA_DB_URL` to run the same tasks against an ephemeral database — that is how the bootstrap check (`e2e/bootstrap/`) drives `task db:setup` against its own Compose project. Keep the default in `Taskfile.yaml` as the `db` hostname; do not hardcode a second URL.
