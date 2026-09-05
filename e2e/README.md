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

The default required host ports are `3000` (web-host), `3080` (Traefik edge), `4000` (web-admin), `4100` (web-platform), `8000` / `8100` (public API Connect / gRPC), `8001` / `8101` (admin API), `8002` / `8102` (platform API), `8003` (outbox worker), `8200` (image-server), `8300` (email-renderer), `5433` (E2E Postgres), `6380` (E2E Redis), `9003` (E2E RustFS / S3), and `1026` / `8026` (E2E Mailpit SMTP / API).

PIDs and logs default to `e2e/.run/`. When `E2E_*_PORT` or `COMPOSE_PROJECT_NAME` changes, `lib.sh` isolates state in a directory based on ports and project name; `E2E_RUN_DIR` takes precedence. A compose-project lease prevents `down` or `start-apps` from another run directory from operating on a remaining stack. The lock holder waits as a single process, so teardown also releases the lock. `task e2e:down` recovers a stale lease by finding the holder through `/proc`, and reports the PID or `fuser` / `lsof` guidance when recovery is impossible.

Use distinct compose projects and **all** distinct ports (`E2E_IMAGE_SERVER_PORT`, `E2E_EMAIL_RENDERER_PORT`, and `E2E_EDGE_PORT` included) for parallel stacks. `PUBLIRA_REDIS_URL` and `PUBLIRA_S3_ENDPOINT` are always built from E2E ports so tests cannot accidentally use Dev Container Redis or RustFS. `lib.sh` provides the required `PUBLIRA_AUTH_SECRET` and `PUBLIRA_AUTH_JWT_SECRET`, forwarding supplied values to each app and API process. `PUBLIRA_REVALIDATE_TOKEN` is defaulted the same way and reaches admin-api-server, the publish-episodes batch, and all three apps, so Next.js cache tags are actually dropped during a run; the `PUBLIRA_WEB_HOST_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, and `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` targets it needs are built from the E2E ports like Redis and S3.

## One-command run

```bash
# Build → start Compose → migrate/seed → start apps → readiness → Playwright → cleanup
task e2e
```

This always tears down app processes and compose volumes, including on failure or interruption.

### Individual commands

| Command | Purpose |
| --- | --- |
| `task e2e:prepare` | Build server binaries, the web apps, and email-renderer; install Playwright Chromium. |
| `task e2e:up` | Start Postgres, Redis, RustFS, Mailpit, and the Traefik edge only. |
| `task e2e:db` | Migrate, apply development seed, point the seeded SMTP settings at the E2E Mailpit, create the S3 bucket (`task storage:init`), and seed the viewer's page fixtures. |
| `task e2e:start-apps` | Start APIs, `publish-episodes`, email-renderer, outbox worker, image-server, and the three web apps in the background. |
| `bash e2e/scripts/{api-server,admin-api-server,platform-api-server}.sh <start\|start-wait\|stop>` | Operate one API server for outage scenarios. |
| `bash e2e/scripts/image-server.sh <start\|start-wait\|stop>` | Operate image-server on its own. |
| `bash e2e/scripts/email-renderer.sh <start\|start-wait\|stop>` | Operate email-renderer on its own. |
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
├── compose.yaml           # postgres + redis + rustfs + mailpit + traefik (project: publira-e2e)
├── fixtures/              # binary test data (viewer page images, eye-catch sources)
├── playwright.config.ts
├── scripts/               # lifecycle, API controls, readiness, test, and locking helpers
├── src/                   # app login, API control, DB, scenario, session, and URL helpers
└── tests/                 # catalogue, admin, host, platform, and health scenarios
```

- **Compose dependencies:** PostgreSQL 18, Valkey (Redis-compatible), RustFS (S3-compatible, path-style, bucket `publira`), Mailpit (SMTP sink), and Traefik.
- **Host processes:** API, admin API, platform API, batch `publish-episodes`, email-renderer, outbox worker, image-server, and standalone `web-host`, `web-admin`, and `web-platform` (`node server.js`).
- **Seed:** development `task db:setup`: public domain `localhost`, admin domain `admin.localhost`, tenant `Seed Tenant`, and platform user `platform@example.com`. The seed tenant and `platform_config` both store `en` as their default locale, so every console and public site opens in English with no `publira_locale` cookie — which is the copy the specs locate elements by. `task e2e:db` then runs `scripts/seed-viewer-pages.sh`, which applies `db/seeds/scenarios/050_viewer_pages.sql` and uploads `fixtures/viewer-pages/*.jpg` to the object keys those rows name, giving `Seed Episode 001-02` a body the canvas viewer can draw. It is deliberately not the series' first episode: 001-01 is the one other suites reach for, and mobile's live integration test reads its empty state as proof of a working round trip.

### Mail

The `mailpit` service is the stack's SMTP sink: intake on `E2E_MAILPIT_SMTP_PORT` (default `1026`), messages on `E2E_MAILPIT_HTTP_PORT` (default `8026`). `task e2e:db` points the platform and tenant SMTP settings at that intake, so what the API servers send lands there.

`src/mail.ts` reads it back over that API, at the origin `MAILPIT_BASE_URL` in `src/urls.ts` names (`E2E_MAILPIT_BASE_URL`): `waitForMessageTo(recipient)` returns the newest message for one address, `clearMessagesTo(recipient)` deletes that address's mail, and `tokenFromLink(message, pathname)` returns the `token` query value of the link whose path matches.

The `email-renderer` service turns a template into the subject, HTML, and text the outbox worker delivers, so mail sent through the worker needs it running. It is a host process like the rest: `E2E_EMAIL_RENDERER_PORT` (default `8300`) is its port, and `PUBLIRA_EMAIL_RENDERER_URL` — built from that port, never inherited — is what points the worker at it. Without it the worker retries every event it picks up until the row dead-letters.

### The edge

Almost every suite talks to `web-host` directly on `:3000`. An episode body image, however, is `/images/episodes/{id}` on the reader's own origin, and only image-server can answer it, so one origin has to serve both. That is what the `traefik` service is for: it listens on `E2E_EDGE_PORT` (default `3080`), sends `/images` to image-server and everything else to web-host, and is the `baseURL` of the `viewer-performance` project alone. A suite that reads a body without being timed — `host.episode-reading.spec.ts` — stays in the ordinary `web-host` project and navigates to the edge by absolute URL, so it never shares the runner with the timing suite. It runs with `network_mode: host` because its backends are host processes on loopback, and its routers are written to `$E2E_RUN_DIR/traefik/routes.yaml` by `up.sh` — a file provider substitutes no variables, and the backend ports are overridable.

An eye-catch is delivered the same way, as `/images/series/{id}/{ratio}/{width}` on the reader's origin. `admin.eye-catch-upload.spec.ts` therefore drives the console on the web-admin origin, where `/images` resolves to nothing, and reads the uploaded bytes back from the edge by absolute URL.

This mirrors the Dev Container's Traefik labels but does not verify them; [`routing/`](./routing/README.md) remains the source of truth for the real routing.

Host-based URL constants are in `src/urls.ts`. web-host accepts one port and resolves the tenant through `Host` / `x-forwarded-host`; Chromium resolves `*.localhost` to loopback under RFC 6761, so neither DNS registration nor a hosts-file entry is needed. Use non-`localhost` hosts only through the browser (`page.goto`), because Node's `request` fixture uses OS name resolution.

## Parallelism and isolation

`playwright.config.ts` uses `workers: 3` and `fullyParallel: false`: files run in parallel while tests within a file run serially. This matches CI's four-vCPU `ubicloud-standard-4`; temporarily serialize with `task e2e:test -- --workers=1`.

Specs that stop a shared process run in isolated projects after the ordinary `web-host`, `web-admin`, and `web-platform` projects, and the `viewer-performance` timing project runs after all of those. `catalog-outage` precedes `catalog-error-boundary`; corresponding admin and platform outage/error-boundary projects preserve the same dependency. Suites that modify shared seed data use `test.describe.configure({ mode: "serial" })` inside that file.

A spec that changes state the whole console reads gets an isolated project for the same reason, and three do:

- `platform-locale-switching` (`platform.locale-switching.spec.ts`): `platform_config` holds a single default language for the deployment, and every web-platform screen without a `publira_locale` cookie renders in it, so the spec runs after `platform-error-boundary` rather than beside the specs that read that console.
- `platform-operator-management` (`platform.operator-management.spec.ts`): it promotes one account seeded by `030_platform_operators.sql` and deactivates another, while `platform.tenant-ops.spec.ts` re-applies that same file from inside its own tests — which would reactivate a deactivated operator half-way through an assertion. It follows `platform-locale-switching`.
- `platform-setup` (`platform.setup.spec.ts`): `/setup` renders only while `platform_users` is empty, so the spec empties it and creates the platform's first operator through the form. Every console sign-in in the suite reads that table, so this project runs after every other one — `viewer-performance` included — and restores the development seed's platform rows on teardown.

## Readiness and failures

| Stage | Failure signal |
| --- | --- |
| Readiness | `readiness failed: <name>` in logs; Playwright does not start. |
| Playwright | `Playwright tests failed`; inspect `test-results/`, `playwright-report/`, and `.run/logs/`. |

`wait-ready` verifies RustFS on `:9003/health`, public/admin/platform API readiness on `:8100`–`:8102`, email-renderer on `:8300/readyz`, the outbox worker on `:8003/readyz`, image-server on `:8200/readyz`, `/livez` / `/readyz` for the three web apps on `:3000`, `:4000`, and `:4100`, and finally web-host's `/readyz` through the edge on `:3080`. `task e2e:up` owns compose health checks for Postgres, Redis, RustFS, and Mailpit.

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
2. Add `e2e/tests/<area>.spec.ts` using `test` / `expect` from `@playwright/test`. `admin.*.spec.ts` runs under the web-admin project; `platform.*.spec.ts` under web-platform. Specs that stop shared processes must include `.outage.` or `.error-boundary.` and use the corresponding dependency chain; a spec that rewrites state the parallel specs read gets an isolated project named after its own file, the way `platform-locale-switching`, `platform-operator-management`, and `platform-setup` do.
3. For a new host, add a project `baseURL` in `playwright.config.ts` or use an absolute `page.goto` URL; centralize constants in `src/urls.ts`.
4. When starting another process, add it and its probe to `scripts/start-apps.sh`, `wait-ready.sh`, and `stop-apps.sh`. Verify Traefik labels in [`routing/`](./routing/README.md), not here.
5. Run `task e2e`, or keep the stack running and use `task e2e:test`.
6. Changes to relevant paths run **Test / E2E**. Changes only in `e2e/routing/**` run **Test / Routing** (`task e2e:routing`) without Playwright.

Current scenarios cover health endpoints, public catalogue browsing and tenant boundaries, catalogue and admin error boundaries, member announcements pagination, announcement delivery from the tenant console to the member list, the member area's My Page and `/settings` tabs, reader sign-up through email confirmation and password reset, the email address change round trip, web-host and web-admin authentication and publishing, published page management from the console through to the public page it puts up, uploading a series' and a label's eye-catch and replacing one aspect ratio of it, tenant brand settings reaching the public site's `/theme.css` and header, platform authentication, tenant operations, initial setup, operator management and the cross-tenant user and tenant-member screens, reading an episode from its first page to its last, UI locale switching in all three apps, the web-admin audit log and read-through report, the operator account and email settings of web-admin and web-platform, and the canvas viewer's rendering budget. Multi-tenant cases use `010_multi_tenant.sql`; announcement delivery and the empty-bell specs use `060_notification_inbox.sql`; platform role-denial and operator-management cases use `030_platform_operators.sql`; the member area uses `070_member_settings.sql`, the email address change `090_email_change.sql`, and the account lifecycle `100_account_lifecycle.sql`; locale switching uses `080_locale_switching.sql`; initial setup restores itself with `110_platform_setup.sql`; the audit log and read-through report use `120_admin_reporting.sql` on top of `010_multi_tenant.sql`; the admin operator-settings suite uses `130_admin_operator_settings.sql` and the platform operator-settings suite `131_platform_operator_settings.sql`; the viewer's pages come from `050_viewer_pages.sql`, which `task e2e:db` applies for every run rather than a suite applying it for itself. The eye-catch suite needs no scenario seed: it creates the series or label it uploads to through the console and removes it afterwards, and its source images are `fixtures/eye-catch/*.jpg`. The brand-settings suite drives `/settings/theme` on the seed tenant and reads the public site's `/theme.css`, header logo, and icon links, restoring the defaults afterwards; tenant isolation uses `010_multi_tenant.sql`. The published page suite creates and removes its own pages the same way, and takes only the foreign page it must fail to open from `010_multi_tenant.sql`.

Outage specs must run through `task e2e:test`, which sources `lib.sh`. Filtering by file name can leave only isolated projects, so pass `--no-deps` when selecting an isolated project directly (for example, `--project=catalog-outage`).

## CI

Job: **Test / E2E** (`.github/workflows/ci.yml`)

- Path filter: `e2e/**` except `e2e/routing/**`, the three web apps, packages, server, db, and related build inputs.
- Failure artifact: `e2e-artifacts` (report, test results, and app logs).
- Chromium only; `workers: 3`, `fullyParallel: false`, and one retry in CI.
- Outage and error-boundary scenarios run as isolated dependent projects after the three ordinary projects, `platform-locale-switching` and then `platform-operator-management` follow the platform chain, `viewer-performance` runs after all of those so nothing competes with it for the runner, and `platform-setup` runs last of everything.
- The required branch check is the final **Summary** job, as with all CI jobs.

See [the workflow overview](../.github/workflows/README.md) for job layout, filters, and failure triage.
