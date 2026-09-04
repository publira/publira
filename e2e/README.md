# E2E test infrastructure

This directory provides shared Playwright infrastructure and scenarios spanning the public catalogue and admin publishing flows. It also standardizes startup, readiness, CI, and artifacts.

Development bootstrap, from empty database volumes through `task setup` and all `task dev` services, uses a separate lifecycle without Playwright; [`bootstrap/README.md`](./bootstrap/README.md) is its source of truth (`task e2e:bootstrap`). Dev Container Traefik host-based routing also uses a separate non-Playwright lifecycle, exercising `.devcontainer/compose.yaml` labels against echo backends; [`routing/README.md`](./routing/README.md) is its source of truth (`task e2e:routing`).

## Prerequisites

- Docker with Compose v2 (Dev Container DinD is supported)
- [wait4x](https://github.com/wait4x/wait4x) for HTTP readiness (included in the Dev Container; CI installs it for **Test / E2E**)
- `task deps` from the repository root
- For the first run, Playwright Chromium OS dependencies:

  ```bash
  pnpm --dir e2e exec playwright install-deps chromium
  # If permissions are needed:
  sudo env "PATH=$PATH" pnpm --dir e2e exec playwright install-deps chromium
  ```

The default required host ports are `3000` (web-host), `3080` (Traefik edge), `4000` (web-admin), `4100` (web-platform), `8000` / `8100` (public API Connect / gRPC), `8001` / `8101` (admin API), `8002` / `8102` (platform API), `8003` (outbox worker), `8200` (image-server), `5433` (E2E Postgres), `6380` (E2E Redis), and `9003` (E2E RustFS / S3).

PIDs and logs default to `e2e/.run/`. When `E2E_*_PORT` or `COMPOSE_PROJECT_NAME` changes, `lib.sh` isolates state in a directory based on ports and project name; `E2E_RUN_DIR` takes precedence. A compose-project lease prevents `down` or `start-apps` from another run directory from operating on a remaining stack. The lock holder waits as a single process, so teardown also releases the lock. `task e2e:down` recovers a stale lease by finding the holder through `/proc`, and reports the PID or `fuser` / `lsof` guidance when recovery is impossible.

Use distinct compose projects and **all** distinct ports (`E2E_IMAGE_SERVER_PORT` and `E2E_EDGE_PORT` included) for parallel stacks. `PUBLIRA_REDIS_URL` and `PUBLIRA_S3_ENDPOINT` are always built from E2E ports so tests cannot accidentally use Dev Container Redis or RustFS. `lib.sh` provides the required `PUBLIRA_AUTH_SECRET` and `PUBLIRA_AUTH_JWT_SECRET`, forwarding supplied values to each app and API process.

## One-command run

```bash
# Build → start Compose → migrate/seed → start apps → readiness → Playwright → cleanup
task e2e
```

This always tears down app processes and compose volumes, including on failure or interruption.

### Individual commands

| Command | Purpose |
| --- | --- |
| `task e2e:prepare` | Build server binaries and web apps; install Playwright Chromium. |
| `task e2e:up` | Start Postgres, Redis, RustFS, and the Traefik edge only. |
| `task e2e:db` | Migrate, apply development seed, create the S3 bucket (`task storage:init`), and seed the viewer's page fixtures. |
| `task e2e:start-apps` | Start APIs, `publish-episodes`, outbox worker, image-server, and the three web apps in the background. |
| `bash e2e/scripts/{api-server,admin-api-server,platform-api-server}.sh <start\|start-wait\|stop>` | Operate one API server for outage scenarios. |
| `bash e2e/scripts/image-server.sh <start\|start-wait\|stop>` | Operate image-server on its own. |
| `task e2e:wait-ready` | Wait for HTTP readiness with wait4x; failure is `readiness failed: …`. |
| `task e2e:test` | Run Playwright only against a running stack. |
| `task e2e:test-lib` | Verify `E2E_RUN_DIR` isolation and compose-project locks (no Docker required; also run by `task e2e`). |
| `task e2e:down` | Stop applications and remove compose resources, including volumes. |

To keep a local stack while iterating:

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test
# …
task e2e:down
```

For Next.js HMR during development, use `E2E_WEB_MODE=dev task e2e`; CI does not use this mode.

## Layout

```text
e2e/
├── bootstrap/             # Development bootstrap check (separate lifecycle, no Playwright)
├── routing/               # Dev Container Traefik check (separate lifecycle, no Playwright)
├── compose.yaml           # postgres + redis + rustfs + traefik (project: publira-e2e)
├── fixtures/              # binary test data (viewer page images)
├── playwright.config.ts
├── scripts/               # lifecycle, API controls, readiness, test, and locking helpers
├── src/                   # app login, API control, DB, scenario, session, and URL helpers
└── tests/                 # catalogue, admin, host, platform, and health scenarios
```

- **Compose dependencies:** PostgreSQL 18, Valkey (Redis-compatible), RustFS (S3-compatible, path-style, bucket `publira`), and Traefik.
- **Host processes:** API, admin API, platform API, batch `publish-episodes`, outbox worker, image-server, and standalone `web-host`, `web-admin`, and `web-platform` (`node server.js`).
- **Seed:** development `task db:setup`: public domain `localhost`, admin domain `admin.localhost`, tenant `Seed Tenant`, and platform user `platform@example.com`. `task e2e:db` then runs `scripts/seed-viewer-pages.sh`, which applies `db/seeds/scenarios/050_viewer_pages.sql` and uploads `fixtures/viewer-pages/*.jpg` to the object keys those rows name, giving `Seed Episode 001-02` a body the canvas viewer can draw. It is deliberately not the series' first episode: 001-01 is the one other suites reach for, and mobile's live integration test reads its empty state as proof of a working round trip.

### The edge

Almost every suite talks to `web-host` directly on `:3000`. An episode body image, however, is `/images/episodes/{id}` on the reader's own origin, and only image-server can answer it, so one origin has to serve both. That is what the `traefik` service is for: it listens on `E2E_EDGE_PORT` (default `3080`), sends `/images` to image-server and everything else to web-host, and is the `baseURL` of the `viewer-performance` project alone. A suite that reads a body without being timed — `host.episode-reading.spec.ts` — stays in the ordinary `web-host` project and navigates to the edge by absolute URL, so it never shares the runner with the timing suite. It runs with `network_mode: host` because its backends are host processes on loopback, and its routers are written to `$E2E_RUN_DIR/traefik/routes.yaml` by `up.sh` — a file provider substitutes no variables, and the backend ports are overridable.

This mirrors the Dev Container's Traefik labels but does not verify them; [`routing/`](./routing/README.md) remains the source of truth for the real routing.

Host-based URL constants are in `src/urls.ts`. web-host accepts one port and resolves the tenant through `Host` / `x-forwarded-host`; Chromium resolves `*.localhost` to loopback under RFC 6761, so neither DNS registration nor a hosts-file entry is needed. Use non-`localhost` hosts only through the browser (`page.goto`), because Node's `request` fixture uses OS name resolution.

## Parallelism and isolation

`playwright.config.ts` uses `workers: 3` and `fullyParallel: false`: files run in parallel while tests within a file run serially. This matches CI's four-vCPU `ubicloud-standard-4`; temporarily serialize with `task e2e:test -- --workers=1`.

Specs that stop a shared process run in isolated projects after the ordinary `web-host`, `web-admin`, and `web-platform` projects, and the `viewer-performance` timing project runs after all of those. `catalog-outage` precedes `catalog-error-boundary`; corresponding admin and platform outage/error-boundary projects preserve the same dependency. Suites that modify shared seed data use `test.describe.configure({ mode: "serial" })` inside that file.

## Readiness and failures

| Stage | Failure signal |
| --- | --- |
| Readiness | `readiness failed: <name>` in logs; Playwright does not start. |
| Playwright | `Playwright tests failed`; inspect `test-results/`, `playwright-report/`, and `.run/logs/`. |

`wait-ready` verifies RustFS on `:9003/health`, public/admin/platform API readiness on `:8100`–`:8102`, image-server on `:8200/readyz`, `/livez` / `/readyz` for the three web apps on `:3000`, `:4000`, and `:4100`, and finally web-host's `/readyz` through the edge on `:3080`. `task e2e:up` owns compose health checks for Postgres, Redis, and RustFS.

## Viewer rendering performance

`tests/host.viewer-performance.spec.ts` puts a budget on the canvas reader (`@publira/comic-viewer`, wired up in `apps/web-host/.../_components/episode-comic-viewer.tsx`) so a rendering regression fails a build instead of being noticed by a reader. The four budgets are `BUDGET` at the top of that file, which is also where each one says what it measures and why it sits where it does.

It runs as its own Playwright project, `viewer-performance`, after every other project has finished, so nothing else on the machine is being measured with it.

`Seed Episode 001-02` is free and the suite reads it signed out, and image-server encrypts a free body as readily as a paid one, so every number above includes reversing `xor-hmac-sha256-v1` in the browser for each page drawn.

### Taking the numbers again

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test -- --project=viewer-performance --no-deps
task e2e:down
```

Each measurement is attached to the test result as a `viewer-performance:<metric>` annotation, so `--reporter=json` (or the HTML report) prints what the run actually measured rather than only whether it stayed under budget. Numbers from a machine that is also running a dev stack are not comparable with CI's; measure on an idle one.

## Adding scenarios

1. Optionally add fixture SQL under `db/seeds/scenarios/<name>.sql` and apply it with `applyScenarioSql('name')` from `src/db.ts`.
2. Add `e2e/tests/<area>.spec.ts` using `test` / `expect` from `@playwright/test`. `admin.*.spec.ts` runs under the web-admin project; `platform.*.spec.ts` under web-platform. Specs that stop shared processes must include `.outage.` or `.error-boundary.` and use the corresponding dependency chain.
3. For a new host, add a project `baseURL` in `playwright.config.ts` or use an absolute `page.goto` URL; centralize constants in `src/urls.ts`.
4. When starting another process, add it and its probe to `scripts/start-apps.sh`, `wait-ready.sh`, and `stop-apps.sh`. Verify Traefik labels in [`routing/`](./routing/README.md), not here.
5. Run `task e2e`, or keep the stack running and use `task e2e:test`.
6. Changes to relevant paths run **Test / E2E**. Changes only in `e2e/routing/**` run **Test / Routing** (`task e2e:routing`) without Playwright.

Current scenarios cover health endpoints, public catalogue browsing and tenant boundaries, catalogue and admin error boundaries, member announcements pagination, the member area's My Page and `/settings` tabs, web-host and web-admin authentication and publishing, platform authentication and tenant operations, reading an episode from its first page to its last, and the canvas viewer's rendering budget. Multi-tenant cases use `010_multi_tenant.sql`; platform role-denial cases use `030_platform_operators.sql`; the member area uses `070_member_settings.sql`; the viewer's pages come from `050_viewer_pages.sql`, which `task e2e:db` applies for every run rather than a suite applying it for itself.

Outage specs must run through `task e2e:test`, which sources `lib.sh`. Filtering by file name can leave only isolated projects, so pass `--no-deps` when selecting an isolated project directly (for example, `--project=catalog-outage`).

## CI

Job: **Test / E2E** (`.github/workflows/ci.yml`)

- Path filter: `e2e/**` except `e2e/routing/**`, the three web apps, packages, server, db, and related build inputs.
- Failure artifact: `e2e-artifacts` (report, test results, and app logs).
- Chromium only; `workers: 3`, `fullyParallel: false`, and one retry in CI.
- Outage and error-boundary scenarios run as isolated dependent projects after the three ordinary projects, and `viewer-performance` runs last so nothing competes with it for the runner.
- The required branch check is the final **Summary** job, as with all CI jobs.

See [the workflow overview](../.github/workflows/README.md) for job layout, filters, and failure triage.
