# E2E test infrastructure

This directory provides shared Playwright infrastructure and scenarios spanning the public catalogue and admin publishing flows. It also standardizes startup, readiness, CI, and artifacts.

Development bootstrap, from empty database volumes through `task setup` and all `task dev` services, uses a separate lifecycle without Playwright; [`bootstrap/README.md`](./bootstrap/README.md) is its source of truth (`task e2e:bootstrap`). Edge routing also uses a separate non-Playwright lifecycle, exercising the reverse proxy configuration under `infra/proxy/` against echo backends; [`routing/README.md`](./routing/README.md) is its source of truth (`task e2e:routing`).

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

The default required host ports are `3000` (web-host), `3080` (Traefik edge), `4000` (web-admin), `4100` (web-platform), `8000` / `8100` (the server's edge-facing and internal listeners; the images are on the first), `8003` (worker), `8300` (email-renderer), `8400` (sign-in-provider), `5433` (E2E Postgres), `6380` (E2E Redis), `9003` (E2E RustFS / S3), `1026` / `8026` (E2E Mailpit SMTP / API), and `3090` (the pinned browser the screenshot projects connect to). `task e2e:search` also needs `9201` (E2E OpenSearch).

PIDs and logs default to `e2e/.run/`. When `PUBLIRA_E2E_*_PORT` or `COMPOSE_PROJECT_NAME` changes, `lib.sh` isolates state in a directory based on ports and project name; `PUBLIRA_E2E_RUN_DIR` takes precedence. A compose-project lease prevents `down` or `start-apps` from another run directory from operating on a remaining stack. The lock holder waits as a single process, so teardown also releases the lock. `task e2e:down` recovers a stale lease by finding the holder through `/proc`, and reports the PID or `fuser` / `lsof` guidance when recovery is impossible.

A lease lives only as long as its holder process, while a stack outlives one, so `up`, `db`, and `start-apps` read ownership off the containers as well: `compose.yaml` labels every service with the run directory that created it (`com.publira.e2e.run-dir`). A stack whose lease holder is gone therefore still refuses a run from another directory, as does a data port already published by a different compose project. `task e2e:down` stays the way to remove a stack nothing owns any more.

Use distinct compose projects and **all** distinct ports (`PUBLIRA_E2E_EMAIL_RENDERER_PORT`, `PUBLIRA_E2E_SIGN_IN_PROVIDER_PORT`, `PUBLIRA_E2E_EDGE_PORT`, and `PUBLIRA_E2E_OPENSEARCH_PORT` included) for parallel stacks. `PUBLIRA_REDIS_URL` (and the apps' `PNCH_REDIS_URL`, which carries the same value) and `PUBLIRA_S3_ENDPOINT` are always built from E2E ports so tests cannot accidentally use Dev Container Redis or RustFS. `lib.sh` provides the required `PUBLIRA_AUTH_SECRET` and `PUBLIRA_AUTH_JWT_SECRET`, forwarding supplied values to each app and API process. `PUBLIRA_REVALIDATE_TOKEN` is defaulted the same way and reaches the server, the worker's periodic jobs, and all three apps (as `PNCH_REVALIDATE_TOKEN`), so Next.js cache tags are actually dropped during a run; the `PUBLIRA_WEB_HOST_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, and `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` targets it needs are built from the E2E ports like Redis and S3. `PUBLIRA_TENANT_URL_SCHEME` is `http`. `scripts/db-setup.sh` applies `db/seeds/scenarios/250_web_push.sql`, which stores a VAPID key pair and a subject, so the public API publishes a VAPID key and web-host serves the browser notification switch the member settings suite drives.

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
| `task e2e:up` | Start Postgres, Redis, RustFS, Mailpit, the Traefik edge, and the screenshot browser only. |
| `task e2e:db` | Migrate, apply development seed, point the seeded SMTP settings at the E2E Mailpit, name the stand-in's disposable-domain list in the platform policy, create the S3 bucket and upload the seed's images (`task storage:seed`), and pin the timestamps the screenshot baseline records. |
| `task e2e:start-apps` | Start the server, email-renderer, the worker, and the three web apps in the background. |
| `bash e2e/scripts/server.sh <start\|start-wait\|stop>` | Operate the server for outage scenarios. One process carries all three namespaces and the images, so this takes every console down with the tenant site. |
| `bash e2e/scripts/email-renderer.sh <start\|start-wait\|stop>` | Operate email-renderer on its own. |
| `bash e2e/scripts/sign-in-provider.sh <start\|start-wait\|stop>` | Operate sign-in-provider on its own. |
| `task e2e:wait-ready` | Wait for HTTP readiness with wait4x; failure is `readiness failed: …`. |
| `task e2e:test` | Run Playwright only against a running stack. |
| `task e2e:search` | The full lifecycle on the OpenSearch search backend, running `tests/catalog.search.spec.ts` alone; see [Catalog search on OpenSearch](#catalog-search-on-opensearch). |
| `task e2e:test-lib` | Verify `PUBLIRA_E2E_RUN_DIR` isolation and compose-project locks (no Docker required; also run by `task e2e`). |
| `task e2e:down` | Stop applications and remove compose resources, including volumes. |

To keep a local stack while iterating:

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test
# …
task e2e:down
```

For Next.js HMR during development, use `PUBLIRA_E2E_WEB_MODE=dev task e2e`; CI does not use this mode.

## Layout

```text
e2e/
├── bootstrap/             # Development bootstrap check (separate lifecycle, no Playwright)
├── routing/               # Edge routing check (separate lifecycle, no Playwright)
├── browser/               # The pinned browser image the screenshot projects render in
├── compose.yaml           # postgres + redis + rustfs + mailpit + traefik + browser, and opensearch in the `search` profile (project: publira-e2e)
├── fixtures/              # test images, rendered from the vector sources in the repository's assets/
├── playwright.config.ts
├── scripts/               # lifecycle, API controls, readiness, test, and locking helpers
├── src/                   # app login, API control, DB, scenario, session, and URL helpers
└── tests/                 # catalogue, admin, host, platform, health, and server log scenarios
    └── __screenshots__/   # committed screenshot baselines, one directory per project
```

- **Compose dependencies:** PostgreSQL 18, Valkey (Redis-compatible), RustFS (S3-compatible, path-style, bucket `publira`), Mailpit (SMTP sink), Traefik, and the browser the screenshot projects connect to.
- **Host processes:** the server (`publira server`: its edge-facing listener carries `publira.v1` and the images, its internal one all three Connect namespaces), email-renderer, the worker (`publira worker`, which also runs the periodic jobs that promote due episodes, apply free window boundaries, and roll tenant days, on the intervals `PUBLIRA_E2E_PUBLISH_EPISODES_INTERVAL_SEC`, `PUBLIRA_E2E_FREE_WINDOW_INTERVAL_SEC`, and `PUBLIRA_E2E_TENANT_DAY_INTERVAL_SEC` shorten to seconds), and standalone `web-host`, `web-admin`, and `web-platform` (`node server.js`).
- **Seed:** development `task db:setup`: public domain `localhost:<edge>`, admin domain `admin.localhost:<edge>`, tenant `Seed Tenant`, and platform user `platform@example.com`. The seed tenant and `platform_config` both store `en` as their default locale, so every console and public site opens in English with no `publira_locale` cookie — which is the copy the specs locate elements by. `task e2e:db` then runs `task storage:seed`, which uploads the images `db/seeds/dev/060_images.sql` names: an eye-catch for every series and label, an icon for every creator, and eight body pages for every episode, so the canvas viewer has something to draw whichever episode a spec opens. The two commenting suites seed episodes of their own, so they call `scripts/upload-episode-pages.sh` for those after applying their scenario: the comment section is the page after the last page of an episode, so those episodes need pages to turn as well, and seeding their tenants for the whole stack would put them in the tenant list the platform screenshot baseline photographs.

### Mail

The `mailpit` service is the stack's SMTP sink: intake on `PUBLIRA_E2E_MAILPIT_SMTP_PORT` (default `1026`), messages on `PUBLIRA_E2E_MAILPIT_HTTP_PORT` (default `8026`). `task e2e:db` points the platform and tenant SMTP settings at that intake, so what publira server and the worker send lands there.

`src/mail.ts` reads it back over that API, at the origin `MAILPIT_BASE_URL` in `src/urls.ts` names (`PUBLIRA_E2E_MAILPIT_BASE_URL`): `waitForMessageTo(recipient)` returns the newest message for one address, `clearMessagesTo(recipient)` deletes that address's mail, and `tokenFromLink(message, pathname)` returns the `token` query value of the link whose path matches.

The `email-renderer` service turns a template into the HTML part of the mail the worker delivers; the subject and the plain-text body are the worker's own. It is a host process like the rest: `PUBLIRA_E2E_EMAIL_RENDERER_PORT` (default `8300`) is its port, and `PUBLIRA_EMAIL_RENDERER_URL` — built from that port, never inherited — is what points the worker at it. A run whose renderer is not up still delivers mail, as text alone, so a suite that asserts on the HTML part needs it running.

The `sign-in-provider` process stands in for Apple's and Google's signing keys. It listens on `PUBLIRA_E2E_SIGN_IN_PROVIDER_PORT` (default `8400`) with a key pair it keeps in the run directory, so a restart signs with the key the server already fetched: publira server reads the public half from `/keys` through `PUBLIRA_SIGN_IN_APPLE_KEYS_URL` and `PUBLIRA_SIGN_IN_GOOGLE_KEYS_URL`, which `lib.sh` builds from that port, and a spec signs the ID token a provider would have issued by posting its claims to `/id-tokens`. It also serves the disposable-domain list at `/disposable-email-domains`, since no list ships with the server: `task e2e:db` names that URL in the platform policy, so a tenant that switches the list on refuses the domains on it, and a spec reads them back with `disposableEmailDomains()` from `src/sign-in-provider.ts`.

### The edge

An image is `/images/...` on the origin of the page that renders it, and only the server can answer it, so one origin has to serve both the app and the images. That is what the `traefik` service is for: it listens on `PUBLIRA_E2E_EDGE_PORT` (default `3080`), sends `/images` to the server, `admin.*` and `platform.*` hosts to the two consoles, and everything else to web-host. Every app is opened through it, so `PUBLIRA_E2E_WEB_HOST_BASE_URL`, `PUBLIRA_E2E_WEB_ADMIN_BASE_URL`, and `PUBLIRA_E2E_WEB_PLATFORM_BASE_URL` name the edge port rather than the apps' own. A tenant is found by its host with the port included, so every seeded and scenario tenant is stored on this port: `task e2e:db` seeds with `PUBLIRA_EDGE_PORT` set to it, and `applyScenarioSql` passes it as `tenant_port`. It runs with `network_mode: host` because its backends are host processes on loopback. Its routing is the repository's own `infra/proxy/traefik/dynamic`, mounted straight in, with only its `services.yaml` replaced by one `up.sh` writes to `$PUBLIRA_E2E_RUN_DIR/traefik/` for this run, because a file provider substitutes no variables and the ports are overridable.

This runs the same routing contract as the Dev Container but does not verify it; [`infra/proxy/README.md`](../infra/proxy/README.md) states the contract and [`routing/`](./routing/README.md) is what checks it.

Host-based URL constants are in `src/urls.ts`. web-host resolves the tenant through `Host` / `x-forwarded-host`, port included, and `tenantHost` gives the stored host for a name on the edge; Chromium resolves `*.localhost` to loopback under RFC 6761, so neither DNS registration nor a hosts-file entry is needed. Use non-`localhost` hosts only through the browser (`page.goto`), because Node's `request` fixture uses OS name resolution.

## Parallelism and isolation

`playwright.config.ts` uses `workers: 3` and `fullyParallel: false`: files run in parallel while tests within a file run serially. This matches the four vCPUs CI's `ubuntu-latest` runner has on a public repository; temporarily serialize with `task e2e:test -- --workers=1`.

### Groups

Every project belongs to one of four groups, and CI runs each group as a job of its own, on a runner and a stack of its own (see [CI](#ci)):

| Group | Projects | What it needs of its stack |
| --- | --- | --- |
| `screenshots` | `screenshots-host`, `screenshots-admin`, `screenshots-platform` | The state `task e2e:db` seeded, before any publishing suite adds to it. |
| `main` | `web-host`, `web-admin`, `web-platform`, `catalog-search` | Nothing beyond the seed. Its files already run beside each other, so CI also shards it across three stacks. |
| `exclusive` | The outage and error-boundary projects, the projects below that rewrite state the whole console reads, and `platform-setup` | No other suite running while one stops a process or rewrites that state; the group keeps its own chain. |
| `performance` | `viewer-performance` | A machine with nothing else running on it. |

`PUBLIRA_E2E_GROUP` runs one group alone, through `task e2e` or `task e2e:test`; a name that is not a group fails the run before any test starts:

```bash
PUBLIRA_E2E_GROUP=exclusive task e2e
```

A dependency between projects of two groups only orders work on a stack they share, so a group run drops it and keeps the dependencies inside the group. A project therefore must not need anything a project of another group leaves behind. Without `PUBLIRA_E2E_GROUP`, every group runs on one stack, ordered by the whole graph described below.

`server-logs` belongs to every group. It is the teardown of every other project, so it reads the logs once everything before it has finished — in a run of the whole graph, in a group run, and in each shard of one.

### Order on one stack

The `screenshots-host`, `screenshots-admin`, and `screenshots-platform` projects run **before** everything else — the `main` projects declare them as `dependencies` — because what they record is the state `task e2e:db` seeded, and the publishing suites add series and episodes to the lists they photograph. A baseline that no longer matches therefore stops the run before the functional projects start: update the baselines (below) and run again.

Specs that stop a shared process run in isolated projects after the ordinary `web-host`, `web-admin`, and `web-platform` projects, and the `viewer-performance` timing project runs after all of those. `catalog-outage` precedes `catalog-error-boundary`; corresponding admin and platform outage/error-boundary projects preserve the same dependency. In an `exclusive` group run the same chain starts at `catalog-outage`. Suites that modify shared seed data use `test.describe.configure({ mode: "serial" })` inside that file.

A spec that changes state the whole console reads gets an isolated project for the same reason, and seven do:

- `platform-locale-switching` (`platform.locale-switching.spec.ts`): `platform_config` holds a single default language for the deployment, and every web-platform screen without a `publira_locale` cookie renders in it, so the spec runs after `platform-error-boundary` rather than beside the specs that read that console.
- `platform-operator-management` (`platform.operator-management.spec.ts`): it promotes one account seeded by `030_platform_operators.sql` and deactivates another, while `platform.tenant-ops.spec.ts` re-applies that same file from inside its own tests — which would reactivate a deactivated operator half-way through an assertion. It follows `platform-locale-switching`.
- `platform-storage-settings` (`platform.storage-settings.spec.ts`): `platform_storage_config` is the one object store every upload and every image read resolves, and the spec empties it once to see the unconfigured state, so it follows `platform-operator-management`, precedes every project that reads an image, and puts the row `task e2e:db` saved back on teardown.
- `platform-webpush-settings` (`platform.webpush-settings.spec.ts`): `platform_webpush_config` holds the installation's one VAPID key pair and subject, which the storefront's browser notification switch depends on, and the spec clears the subject to see the unconfigured state, so it follows `platform-storage-settings`, runs after the `web-host` project whose member settings suite subscribes a browser, and puts the row `task e2e:db` saved back on teardown.
- `platform-configuration-status` (`platform.configuration-status.spec.ts`): the configuration overview is read from those same two rows, and the spec empties the object store and clears the Web Push subject to see an unfinished installation, then saves the store again, so it follows `platform-webpush-settings` and puts both rows `task e2e:db` saved back on teardown.
- `admin-mfa-sign-in` (`admin.mfa-sign-in.spec.ts`): `platform_policy_config` decides whether a tenant administrator without an authenticator is held at `/mfa` for an enrollment, and the spec requires it of every tenant administrator to enroll one, so it follows `admin-age-verification`, precedes `viewer-performance`, and clears the requirement again on teardown.
- `platform-setup` (`platform.setup.spec.ts`): `/setup` renders only while `platform_users` is empty, so the spec empties it and creates the platform's first operator through the form. Every console sign-in in the suite reads that table, so this project runs after every other one but `server-logs` — `viewer-performance` included, when that shares the stack — and restores the development seed's platform rows on teardown.

## Catalog search on OpenSearch

The stack searches the catalog on PostgreSQL. `PUBLIRA_E2E_SEARCH_BACKEND` selects the backend a run puts the server, the worker, and `publiractl` on, and `scripts/lib.sh` derives everything else from it, never from an inherited `PUBLIRA_SEARCH_BACKEND`:

| `PUBLIRA_E2E_SEARCH_BACKEND` | Backend | Engine |
| --- | --- | --- |
| `sql` (default) | `PUBLIRA_SEARCH_BACKEND=sql` | Not started |
| `opensearch` | `PUBLIRA_SEARCH_BACKEND=opensearch`, `PUBLIRA_OPENSEARCH_URL=http://127.0.0.1:<PUBLIRA_E2E_OPENSEARCH_PORT>` | The `opensearch` service, through `COMPOSE_PROFILES=search`, on `PUBLIRA_E2E_OPENSEARCH_PORT` (default `9201`) |

On `opensearch`, `task e2e:db` ends with `publiractl search reindex`, since the seed writes straight to Postgres and queues none of the events that keep the index in step; everything a spec writes through a console reaches the index through the worker. The engine is the image [`infra/docker/opensearch`](../infra/docker/opensearch/Dockerfile) builds, with no volume.

`task e2e:search` sets `PUBLIRA_E2E_SEARCH_BACKEND=opensearch` and runs the `catalog-search` project with `--no-deps`. That project is `tests/catalog.search.spec.ts` alone, and an ordinary `task e2e` runs it too, on SQL, in the `main` group: the publish and unpublish case holds on both backends, and the cases only the engine answers — a reading typed in kana, a word with a wrong character — are registered on OpenSearch alone.

To keep a stack on the engine while iterating, export the variable for every step:

```bash
export PUBLIRA_E2E_SEARCH_BACKEND=opensearch
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test -- --project=catalog-search --no-deps
task e2e:down
```

## Readiness and failures

| Stage | Failure signal |
| --- | --- |
| Readiness | `readiness failed: <name>` in logs; Playwright does not start. |
| Playwright | `Playwright tests failed`; inspect `test-results/`, `playwright-report/`, and `.run/logs/`. |

`wait-ready` verifies RustFS on `:9003/health`, the server's readiness on `:8100` (one probe, and its body names a check per database role), email-renderer on `:8300/readyz`, sign-in-provider on `:8400/readyz`, the worker on `:8003/readyz`, `/livez` / `/readyz` for the three web apps on `:3000`, `:4000`, and `:4100`, and finally web-host's `/readyz` through the edge on `:3080`. `task e2e:up` owns compose health checks for Postgres, Redis, RustFS, and Mailpit.

## Fixture images

`fixtures/eye-catch/*.jpg` are what `admin.eye-catch-upload.spec.ts` picks in the console's file field: one card per accepted aspect ratio, a 2400x3200 card large enough for all four at once, and a 600x800 card below the portrait minimum.

None of them is edited directly. Their vector originals are in the repository's [`assets/`](../assets/README.md), which maps each one to the paths it renders to, and `task images:gen` renders them.

## Screenshot baseline

`tests/host.screenshots.spec.ts`, `admin.screenshots.spec.ts`, and `platform.screenshots.spec.ts` record what a screen looks like, so a change to it arrives for review as an image beside the image it replaces. Each screen is taken full-page at 390px, the width of a phone, and at 1280px, the width the two consoles are used at. The baselines are committed under `tests/__screenshots__/<project>/<screen>-<width>.png`; a run compares against them and fails with a diff image in `test-results/`.

Screens covered: the public site's catalog top page, ranking, series list, label list, creator list, series detail, label detail, creator detail, an episode with a comic body and one with no body, search results, sign-in, and not-found; the tenant console's sign-in, dashboard, series list, series edit form, theme settings, and the public site preview behind that screen's tab; the operator console's sign-in, dashboard, and tenant list.

Two things make a shot on one machine comparable with the run on another:

- **The browser is pinned.** Fonts, FreeType, and Chromium all decide where a pixel goes, and a workstation shares none of them with a CI runner. `browser/Dockerfile` builds the Playwright image of the exact `@playwright/test` release this package depends on, adds the Noto CJK faces the font stacks fall back to on Linux — at a pinned package version, from a pinned Ubuntu archive snapshot, so a rebuild installs the same outlines rather than the day's — and runs `playwright run-server`; only the screenshot projects connect to it, through `connectOptions`. Everything else keeps driving the Playwright Chromium installed on the host. `task e2e:up` builds it, which pulls a base image of a couple of gigabytes the first time. Bumping `@playwright/test` means bumping the image tag in the same commit.
- **The dates are pinned.** The development seed publishes its catalogue and creates its accounts relative to the moment it runs, and six of these screens print one of those timestamps. `db/seeds/scenarios/160_screenshot_baseline.sql`, applied by `task e2e:db`, rewrites them to fixed literals.
- **The ranking is seeded.** Nothing in the development seed produces the reading signals the engagement batch ranks, so the ranking page and the top page's numbered module would photograph as an empty state and a recommendation shelf. `db/seeds/scenarios/170_ranking.sql`, applied by `task e2e:db` for the same reason as the baseline above, writes the snapshots that batch would have computed.

### Updating a baseline after an intended change

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test -- --project=screenshots-host --project=screenshots-admin --project=screenshots-platform --update-snapshots
task e2e:down
```

Run it against a stack that has just been seeded — a stack the whole suite has already run on holds the series, episodes, and tenants those suites created, and they are in the shot. Commit the changed PNGs with the change that caused them; a redesign pull request is reviewed by looking at them.

## Viewer rendering performance

`tests/host.viewer-performance.spec.ts` puts a budget on the canvas reader (`@publira/comic-viewer`, wired up in `apps/web-host/.../_components/episode-comic-viewer.tsx`) so a rendering regression fails a build instead of being noticed by a reader. The four budgets are `BUDGET` at the top of that file, which is also where each one says what it measures and why it sits where it does.

It runs as its own Playwright project, `viewer-performance`, so nothing else on the machine is being measured with it: in CI it is the `performance` group, on a runner of its own, and on a stack every group shares it runs after every other project but `platform-setup` and `server-logs` has finished.

`Seed Episode 001-02` is free and the suite reads it signed out, and the server encrypts a free body as readily as a paid one, so every number above includes reversing `xor-hmac-sha256-v1` in the browser for each page drawn.

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
2. Add `e2e/tests/<area>.spec.ts` using `test` / `expect` from `@playwright/test`. `admin.*.spec.ts` runs under the web-admin project; `platform.*.spec.ts` under web-platform. Specs that stop shared processes must include `.outage.` or `.error-boundary.` and use the corresponding dependency chain; a spec that records a screen is named `.screenshots.` and joins the project of the app it photographs; a spec that rewrites state the parallel specs read gets an isolated project named after its own file, the way `platform-locale-switching`, `platform-operator-management`, and `platform-setup` do, in the `exclusive` group. A new project joins the group whose stack it can share (see [Groups](#groups)); a group of its own also needs an entry in the `Test / E2E` matrix.
3. For a new host, add a project `baseURL` in `playwright.config.ts` or use an absolute `page.goto` URL; centralize constants in `src/urls.ts`.
4. When starting another process, add it and its probe to `scripts/start-apps.sh`, `wait-ready.sh`, and `stop-apps.sh`. Verify edge routing in [`routing/`](./routing/README.md), not here.
5. Run `task e2e`, or keep the stack running and use `task e2e:test`.
6. Changes to relevant paths run **Test / E2E**. Changes only in `e2e/routing/**` run **Test / Routing** (`task e2e:routing`) without Playwright.

`tests/` is the list of suites, and [`db/seeds/scenarios/README.md`](../db/seeds/scenarios/README.md) says which scenario seed each one applies.

Outage specs must run through `task e2e:test`, which sources `lib.sh`. Filtering by file name can leave only isolated projects, so pass `--no-deps` when selecting an isolated project directly (for example, `--project=catalog-outage`).

## CI

Job: **Test / E2E** (`.github/workflows/ci.yml`)

- Path filter: `e2e/**` except `e2e/routing/**`, the three web apps, packages, server, db, and related build inputs.
- A matrix with one entry per [group](#groups), and three for `main`, which runs as `--shard=1/3` to `--shard=3/3`. Every entry runs `task e2e:run` with `PUBLIRA_E2E_GROUP` set, so it builds, seeds, and tears down a stack of its own; one runner per entry is what keeps the default compose project, ports, run directory, database, bucket, and Redis of one entry away from every other.
- Failure artifact: `e2e-artifacts-<entry>` (report, test results, and app logs of that entry), such as `e2e-artifacts-main-2`.
- Every entry also uploads a Playwright blob report, `e2e-blob-<entry>`. When an entry fails, **Test / E2E Report** merges them into one HTML report, `e2e-report`, whose tests carry the tag of the group they ran in.
- Chromium only; `workers: 3`, `fullyParallel: false`, and one retry in CI.
- The `screenshots` entry renders in the browser image compose builds.
- The required branch check is the final **Summary** job, as with all CI jobs; it reports the matrix as one `Test / E2E` result.

Job: **Test / E2E Search** runs `task e2e:search`. Its path filter is the OpenSearch backend and its wiring — the search packages under `server/`, `db/query/catalog_index.sql`, `infra/docker/opensearch/**`, the E2E compose file, lifecycle scripts, Taskfile, Playwright configuration, `tests/catalog.search.spec.ts` and the helpers under `src/`, and `db/seeds/**`, whose rows the OpenSearch-only cases search for — and its failure artifact is `e2e-search-artifacts`.

See [the workflow overview](../.github/workflows/README.md) for job layout, filters, and failure triage.
