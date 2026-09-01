# Development-environment bootstrap check

This check verifies the full path from setup in a clean environment through starting every development service, using the real development commands: `task setup` and `task dev`.

## Why it is needed

A PostgreSQL 18 data-directory change once disagreed with the Compose volume mount and prevented the database container from starting, causing `task setup` to fail. `pnpm preflight` cannot see this configuration issue, and Playwright E2E ([`../README.md`](../README.md)) uses its own `e2e/compose.yaml` stack rather than the Dev Container definition.

This check therefore starts **`.devcontainer/compose.yaml` itself** under a dedicated project name and reproduces the experience of beginning development with empty volumes.

## Prerequisites

- Docker with Compose v2 that supports `!override`
- `task`, `psql`, `migrate`, [wait4x](https://github.com/wait4x/wait4x), Node.js, pnpm, Go, and `aws` (used to create the S3 bucket). The Dev Container includes the `aws-cli` feature and wait4x; CI installs wait4x in **Test / Bootstrap**.
- The following ports must be free:

| Use | Port | Notes |
| --- | --- | --- |
| Bootstrap Postgres | `5434` | Change with `BOOTSTRAP_POSTGRES_PORT`. |
| Bootstrap Redis | `6381` | Change with `BOOTSTRAP_REDIS_PORT`. |
| Bootstrap RustFS (S3) | `9002` | Change with `BOOTSTRAP_RUSTFS_PORT`. |
| All services from `task dev` | `3000` `4000` `4100` `8000`–`8002` `8100`–`8102` `8200` `8201` | **Cannot change**; Next.js ports are fixed in `apps/*/package.json` `dev` commands. |

The data-store ports differ from Playwright E2E (`5433` / `6380` / `9003`), so both can run together. `task dev` ports are fixed, however, so phase 4 cannot run while another development `task dev` is active; the check detects the collision before startup.

## Run

```bash
task e2e:bootstrap
```

It always tears down the `task dev` process group, compose project, and volumes after success, failure, or interruption.

### Individual commands

| Command | Purpose |
| --- | --- |
| `task e2e:bootstrap:up` | Phase 1: start `db`, `redis`, and `rustfs` with empty volumes. |
| `task e2e:bootstrap:setup` | Phase 2: run `task setup` and verify migration / seed. |
| `task e2e:bootstrap:restart-db` | Phase 3: verify persistence after restarting DB and RustFS. |
| `task e2e:bootstrap:dev-up` | Phase 4a: start `task dev` in the background. |
| `task e2e:bootstrap:dev-wait` | Phase 4b: wait for every health probe with wait4x. |
| `task e2e:bootstrap:dev-down` | Stop the `task dev` process group. |
| `task e2e:bootstrap:down` | Tear down (`dev-down` and compose removal). |

To preserve a local development `task dev`, run `BOOTSTRAP_SKIP_DEV=1 task e2e:bootstrap` for phases 1–3 only. CI does not use this option.

## What it verifies

| Phase | Action | Assertions |
| --- | --- | --- |
| 1 | Start `db`, `redis`, and `rustfs` in dedicated project `publira-bootstrap`. | `publira-bootstrap_postgres-data` mounts at `/var/lib/postgresql`; `data_directory` is below it (for PG 18, `/var/lib/postgresql/18/docker`); `PG_VERSION` exists; `schema_migrations` does not yet exist; teardown removes the Postgres and RustFS volumes. |
| 2 | Run `task setup` (or `task deps` + `task db:setup` + `task storage:init` without Flutter). | `schema_migrations` is current and clean; seed tenant `localhost` exists; main tables are non-empty; a second `task db:seed` leaves counts unchanged; a second `task storage:init` succeeds, proving idempotent bucket creation. |
| 3 | `compose stop db rustfs` then `compose up --wait db rustfs`. | Data directory, migration state, and all seed counts match before restart; a sentinel object and its contents remain in the bucket before rerunning `storage-init`; subsequent `task db:setup` and `task storage:init` stay clean. |
| 4 | Run `task dev`. | Five Go servers (public / admin / platform API Connect + gRPC ports, image, and admin image) and three Next.js apps return 200 from `/livez` and `/readyz`; all 11 ports listen; the bootstrap Redis has application connections. |

Phase 2 runs all of `task setup` only where Flutter SDK is available (the Dev Container). Elsewhere it runs `task deps` without `mobile:deps` plus `task db:setup`; **Test / Mobile** owns mobile dependencies.

`scripts/lib.sh` exports `PUBLIRA_DB_URL`, `PUBLIRA_*_DB_URL`, `PUBLIRA_REDIS_URL`, `PUBLIRA_S3_*`, `AWS_*`, `PUBLIRA_AUTH_SECRET`, and `PUBLIRA_AUTH_JWT_SECRET` so `task dev` uses the bootstrap stack. The two secrets are check values—not stack addresses—required for Next.js session encryption and Go access-token signing. Storage uses Dev-Container path style, with `PUBLIRA_S3_ENDPOINT` fixed to bootstrap RustFS at `http://127.0.0.1:${BOOTSTRAP_RUSTFS_PORT}`. API targets keep their usual localhost ports.

The phase-4 Redis `connected_clients` assertion rules out apps that return 200 while connected to a different Redis. Turbo uses strict environment mode; without `PUBLIRA_REDIS_URL` in `turbo.json` `dev` `passThroughEnv`, an app would fall back to `redis://localhost:6379`.

## Layout

```text
e2e/bootstrap/
├── compose.override.yaml   # Overlay for .devcontainer/compose.yaml (published ports + DB healthcheck)
├── Taskfile.yaml
└── scripts/
    ├── lib.sh              # Paths, URLs, probes, and assertion helpers
    ├── run.sh              # Phases 1–4, always teardown, and failure-log collection
    ├── up.sh / setup.sh / restart-db.sh
    ├── dev-up.sh / dev-wait.sh / dev-down.sh
    └── down.sh
```

Dev Container `rustfs` does not publish its S3 endpoint because app containers reach `http://rustfs:9000`. Bootstrap runs `task dev` on the host, so `compose.override.yaml` publishes `127.0.0.1:9002`.

`task db:setup` uses the bootstrap DB because `db/Taskfile.yaml` gives `PUBLIRA_DB_URL` precedence over its default. When unset, it keeps targeting the Dev Container `db` service.

## Failure triage

The failing `[bootstrap] ERROR: …` message identifies the phase.

1. **phase 1** — inspect the `db` image and volume in `.devcontainer/compose.yaml` for the same class of regression as the data-directory change above.
2. **phase 2** — investigate migrations or seeds in `db/migrations/` and `db/seeds/` ([`../../db/AGENTS.md`](../../db/AGENTS.md)).
3. **phase 3** — data did not persist to the volume. Check the DB mount / `data_directory` relationship, or the `rustfs-data` volume and sentinel object.
4. **phase 4** — inspect the named service in `readiness failed: <name>` and `.run/logs/task-dev.log`.

Teardown leaves `.run/logs/task-dev.log` whenever phase 4 ran, and writes `compose-ps.log` / `compose.log` on failure.

## CI

Job: **Test / Bootstrap** (`.github/workflows/ci.yml`)

- Path filter: `.devcontainer/**`, `db/**`, `e2e/bootstrap/**`, `apps/**`, `packages/**`, `server/**`, `Taskfile.yaml`, lockfiles, and related paths. Because `task dev` starts every application and server, any of these sources can break it.
- It also runs nightly (`schedule`) because `.devcontainer/**` changes are rare in ordinary PRs.
- Failure artifact: `bootstrap-artifacts` (`.run/logs/`).

See [the workflow overview](../../.github/workflows/README.md) for all CI jobs.

## Out of scope

- Major-version upgrades of existing database data
- Individual UI scenarios ([`../README.md`](../README.md))
- Traefik routing verification ([`../routing/README.md`](../routing/README.md))
