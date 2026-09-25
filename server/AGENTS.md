# Server Agent Guide

Conventions for the Go backend module `github.com/publira/publira/server`. Prefer this file for server work; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth for repo-wide agent policy. Database schema rules: [`db/AGENTS.md`](../db/AGENTS.md).

## Layout

| Path | Role |
| --- | --- |
| `cmd/` | Thin entrypoints only: `publira`, whose `server` command serves the API and image delivery and whose `worker` command is the long-lived process that schedules every recurring job, and `publiractl`, the command that operates an install, including running a maintenance job by hand |
| `api/` | ConnectRPC handlers (admin / platform / public). Each package exports the registrar `publira server` mounts on a mux, never a whole listener's handler; `internal/imageserver` exports its image routes the same way |
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
3. **Every recurring background job is a River job the `publira worker` process schedules**, never a cron entry, a Kubernetes CronJob, or a process on a ticker of its own. `publira worker` is the one long-lived background process: it drains the Outbox and hosts every River-backed job, so a new class of background work joins it rather than bringing a second River client, and a deployment that runs the worker needs no scheduler beside it. The schedule, the overlap guard, and a record of each due run come with River instead of being a deployment to supervise, and `cmd/publira` only wires the jobs into the client, per rule 2. Every such job gets:
   - `UniqueOpts` over River's in-flight states. Each one spans every tenant, so two runs at once — from two worker replicas, or a pass that outlasts its interval — would write the same rows twice.
   - A queue of its own rather than River's default one, which the Outbox drain is sized for: one pass is long and rare where an outbox job is short and constant.
   - A `service.name` of its own through `tracing.Setup`, so its runs stay apart in a trace UI now that they share a process.
   - A pool of its own, on the role named for its work, never the worker's own pool: that login owns River's schema and holds `CREATE ON SCHEMA public`, which is the privilege the jobs must not have.
4. **Which family a recurring job joins follows what it answers to.**
   - A job that has to act the moment a stored instant passes — a scheduled publication, a free window boundary, a tenant's midnight — is a ticker job in `internal/tickerjobs`, on the `ticker` queue, connecting as `publira_ticker`. It runs on start and then on a short interval, so an instant that passed while the worker was down is acted on when it returns.
   - A job that rebuilds or purges a period of data is a maintenance job, connecting as `publira_content_stats` on the `maintenance` queue. Its work is a settings type and a `Run` method in `internal/maintenance`, and its River kind in `internal/maintenancejobs` only wraps it. A rebuild of dated state records per tenant how far it has got (`daily_rebuild_progress`) and rebuilds every day it missed, in the chain's dependency order, rather than only the latest one. A purge drains everything past its cutoff at the moment it runs, so it needs no such record and is unique per interval instead, which keeps a restart from being another pass.
   - Every maintenance job is also a `publiractl job <kind>` subcommand (`cmd/publiractl`), the manual interface for backfilling a named date, recovering after an incident, a dry-run purge, or a one-off pass. Nothing schedules it. The correspondence is one-to-one: each subcommand is exactly one River kind in `internal/maintenancejobs`, named alike, and invokes the same `internal/maintenance` job that kind does, so a new job is an entry in both tables and an implementation in neither, and never code inside `cmd/`. It resolves `service.name` as `publira-<kind>`, the name the River kind's runs report as well; `TestJobsMatchTheWorkerMaintenanceKinds` fails when the two tables drift. `publiractl` is one binary and one image, so a new job is a new entry in its job table, never a new `cmd/` directory: per-job directories multiply the Docker matrix and the registrations in `infra/docker/Taskfile.yaml` and `scripts/ci-plan-jobs.sh`.
   - Ticker jobs get no `publiractl job` subcommand. A ticker job acts on every instant that has passed each time it runs, the first run after the worker starts included, so a manual run could do nothing the worker does not.
   - The correspondence binds the `job` group only. A `publiractl` command outside it — an install's own operation, such as creating a tenant — is not a worker job and is not held to it.
5. Never commit hand-edits to generated output. Regenerate instead. Every generator in this module writes into a `gen/` directory under the `internal/` package it belongs to — buf into `internal/proto/gen/`, sqlc into `internal/db/gen/`, the locale registry into `internal/locale/gen/` — so no file outside one is generated and the rule needs no list of file names.

## UI locale: no default

`internal/locale` has no `Default`, and adding one back under any name is forbidden. `locale.Resolve` reports `ErrUnresolved` for a stored value naming no supported code, and every caller fails on it: an RPC with `internalError` (`CodeInternal`), the invitation job with `Permanent`. Never with another language — a wrong locale shows the reader a page they cannot read and hides the fault that produced it.

The contrast with `tenanttz.Default` is deliberate: a timestamp rendered in the wrong zone is off by hours and still legible, so the time zone keeps its last-resort constant.

Each path takes the locale from the row it is about — `tenants.default_locale` for anything tenant-facing, the job payload for work that has no such row. `platformconfig.DefaultLocale` answers the platform console's own display language and stands in for no other row; tenant creation takes the locale from its request, and `CreateInitialUser` from the operator's choice on the setup screen.

The one empty answer is `CheckSetupStatus` on a platform whose settings row does not exist yet: nothing has been saved, and the setup screen negotiates its first language from `Accept-Language`. A row that exists and names no supported locale is not that state and fails like every other read. Resolve the locale before anything that fails retriably, too — the invitation job does it before the SMTP settings, so an outage cannot disguise a locale no retry can fix.

No lint covers this. The read paths are in `api/*/`, `internal/outbox/`, and `internal/platformconfig/`; the frontend half of the same rule is the **UI locale** section of [`apps/AGENTS.md`](../apps/AGENTS.md).

## A mail's own words are the catalogs', not the renderer's

`emailrenderer` answers with the HTML part of a mail and nothing else. The subject line and the plain-text alternative are composed in `internal/outbox` out of `locales/*.json`, through `locale.Message` and `locale.FormatDateTime` over the tables `scripts/generate-locale-registry.ts` compiles into `internal/locale/gen/`. Putting a subject back into `RenderEmailResponse` would make a separate service the only source of one again, and a mail unsendable for as long as that service is down.

The same reasoning makes the renderer optional: a worker started without `PUBLIRA_EMAIL_RENDERER_URL` delivers the text it composed and calls nothing, and no default URL may be reintroduced — one would point every deployment that runs no renderer at a service that is not there.

A template is therefore two halves added together: the React component under `packages/email-templates`, and the entry in `emailTemplates` (`internal/outbox/email_copy.go`) naming, in order, the catalog keys its lines are read from. A mail whose template has no entry there fails permanently rather than going out with no subject.

No lint covers this — nothing can compare a React component against a list of message keys. `TestEmailCopyCoversEveryTemplateInEveryLocale` is what fails when a catalog is missing one of them.

## A role variable resolves on its own, and no one else's

Each connection is made with the dedicated PostgreSQL login named for the work it does, read from that role's own `PUBLIRA_*_DB_URL` and falling back to its development URL. `PUBLIRA_DB_URL` is not a link in that chain: it is the migration tooling's connection and the superuser locally, so a process that falls back to it runs with more privilege than the role it was given, in exactly the deployment where the variable was forgotten. Failing to authenticate on a development password is the better outcome, and it is what every server already does.

Neither may one chain reach into another's variable. A shared fallback looks harmless while both happen to run on the same connection and turns into a silent role change the day either one is repointed. The `publiractl job` subcommands are the one place a chain runs several variables deep, and it stays inside the jobs' own names before ending at `PUBLIRA_DB_URL`.

The rule is about roles rather than about processes, and the two processes show why. `publira worker` opens a pool for its ticker jobs (`PUBLIRA_TICKER_DB_URL`) and another for its maintenance jobs (`PUBLIRA_CONTENT_STATS_DB_URL`) because the login that owns River's schema is not the one either should write with, and neither is the other's. And `publira server` serves all three Connect namespaces and therefore opens a pool per login — `PUBLIRA_PUBLIC_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PLATFORM_DB_URL` — picking the pool by the namespace the procedure path names, and answering an image on the public or the admin pool by the host it arrived on. Three chains in one process are still three chains; sharing a pool between namespaces would hand `publira.v1` the `BYPASSRLS` reach of `publira_platform`, and the image routes get no pool of their own because they answer as logins the process already holds.

Adding a role means adding it to `db/seeds/baseline/000_rls_bypass_role.sql` with the grants that process needs, pointing local development at it (`scripts/dev-env/lib.sh`, `e2e/scripts/lib.sh`, `e2e/bootstrap/scripts/lib.sh`), and updating the **Database users** table in [README.md](README.md). A role that only production uses is a role whose grants are first exercised on a deploy.

No lint covers this — the variable names are strings in each `cmd/` entrypoint.

## Stored objects must be named by a row the sweep knows

The orphan image sweep — `maintenance.purge_orphan_images` on the worker, and `publiractl job purge-orphan-images` by hand — treats the database as the authority over the bucket: it walks every object under `tenants/` and deletes the ones no `*_image_variants` row names. A new upload path that writes under that prefix without a row in one of those tables therefore has its objects deleted a day later, silently.

So a new kind of stored object either records its key in one of the existing `*_image_variants` tables, or brings its own table and a clause in `ListReferencedObjectKeys` (`db/query/storage.sql`) — never a bare `Upload` with the key kept somewhere else. Where the row points at an image an entity elects (an icon, an eye catch), add the matching `DeleteUnreferenced*Images` query too, so a replaced image's row stops protecting its objects.

No lint covers this. The reclamation logic is `internal/orphanimages`, documented in [`cmd/publiractl/README.md`](cmd/publiractl/README.md).

## A reader-writable RPC charges the shared flood control

Every public RPC a signed-in reader writes through spends an allowance before it reaches the database: `chargeReaderAction` in `api/publicapi`, over the counters in `internal/ratelimit`. Adding one is an action name and its rules in `reader_guards.go`, its limits in the platform policy (`internal/platformpolicy`, stored in `platform_policy_config` and edited through `PlatformPolicyService` and `publiractl policy set`), and the charge in the handler — never a limiter of its own or an environment variable, either of which would be a second policy an operator has to find before they can raise a limit.

An RPC that stores something a reader can repeat verbatim also claims that text for the window, so the same body arriving twice is refused rather than stored twice.

The counters live in Redis when `PUBLIRA_REDIS_URL` names one and in this process when it does not, and a Redis that stops answering falls back to the in-process counters rather than to no limit: a rate limiter that fails open is one an outage turns into the flood it was there to stop.

The step-up password check is one of those actions and is charged differently. `ChangePassword`, `DeleteMe` and `RequestEmailChange` ask for the account's password on top of the session, and every RPC that does spends `actionVerifyPassword` — one budget for all of them, because a budget per RPC would hand a guesser one of each to rotate between. The charge goes **before the verification**, so an attempt past the limit costs no bcrypt and reaches no row, and a verification that succeeds clears the count through `clearReaderAction`: the limit is there for the caller who does not know the password, and that caller never gets that far.

A public RPC a **guest** may write through charges a second action keyed on the caller instead of on an account, through `chargeClientAction`: there is no account to hold a budget, so a limit that only knew accounts would be no limit at all. `SubmitContactMessage` is the one that does, and it spends both — the client's whoever is asking, and the account's on top when there is one — so signing up does not widen what one client may send. The client's key leaves the tenant out, the way `mailguard`'s origin allowance does, because what it bounds is one caller spreading the same traffic over every storefront on the platform.

No lint covers this — nothing can tell an RPC that writes on a reader's behalf from one that does not, or one that asks for a password from one that does not.

## A cache invalidation is recorded before anything sends it

A write that leaves a Next.js cache entry stale goes through `revalidate.Requester`, never through `revalidate.Client` directly: the client is the sender, and the two places that drive it are the requester's own immediate attempt and the outbox handler behind it. `Record` writes the tags down as a `next_cache_revalidation` outbox event, on the querier of the write it answers for, so a handler inside a transaction commits the debt with the row it is about and a rollback takes both. `Send` then attempts the drop on a context of its own, off the caller's goroutine, and marks the event done once every app has answered.

The order is the whole rule: record first, on the write's own querier, and send only once that write has committed. A send before the commit fills the cache back up with the answer the write is replacing, and a record after it is a drop a crash can lose — which is the state this replaced, where the row committed and an HTTP call nothing remembered followed it. A record that fails inside a transaction fails the handler and rolls that transaction back, rather than committing a write whose drop nothing owes; a record that fails after the commit is only logged, because there is nothing left to undo.

A caller that marks work done on the strength of the invalidation — the free window boundaries, the day roll — keys that on the record rather than on the send, because the record is what guarantees the drop will happen. A caller inside the `worker` process itself records and stops there: the drain that sends it is seconds away, and `publira_ticker` may insert an outbox event and not update one, so an attempt from there could not be marked done and would be sent twice.

No lint covers this. `revalidate.Client` has to stay exported for the worker's handler, so nothing can tell a handler that took one from the worker that owns it.

## A form that mails an address charges the mail guard

An RPC that queues mail for an address the request has not authenticated spends two allowances first, through `internal/mailguard`: one held by the mailbox, one held by the request's origin. `CreateUser`, `RequestEmailVerification`, `RequestPasswordReset` and `RequestEmailChange` all do, on every API surface that has them, and a new form of the same shape is a `Guard.Allow` call with the tenant's id as its scope — `mailguard.PlatformScope` for the console that has no tenant.

The charge goes **as late as it can and still be before the first write**, and never after one: an attempt refused after a write would leave the outbox an event the worker has to recognize and drop. Every check that can reject the request without mailing anything therefore runs first, because an allowance spent on a request that sends no mail is one the mailbox it names cannot spend on its own password reset. `RequestEmailChange` is where that bites: it answers an address that already has an account with `already_exists` and mails nothing, so charging before that lookup would let any signed-in caller burn the allowance of every address they can name.

The exception is the forms that answer a registered address exactly as they answer a free one — `CreateUser`, `RequestEmailVerification`, `RequestPasswordReset`. Their handlers never look the address up: they charge the guard, record the request as an outbox event as their only write, and leave it to the worker to decide which case the address is in, so neither the answer nor the time it takes depends on it.

A caller over either allowance gets `resource_exhausted` with `Retry-After` and nothing else.

An RPC that mails several addresses in one request charges them through `Guard.AllowEach`, which gives back everything the request spent when any one of them is refused.

Mail a session-bearing RPC sends to the account's own confirmed address — a password-changed notice, an email-changed notice — is not this: there is an account to attribute it to and no arbitrary recipient to aim.

No lint covers this — nothing can tell an RPC that queues mail for an address the caller chose from one that queues it for an address already on file.

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
- Version bumps: `GOLANGCI_LINT_VERSION` in [`ci.yml`](../.github/workflows/ci.yml) is the one pin; the Dev Container image (`publira/base-images`) installs the same version and is updated separately.

### When codegen inputs change

If you touched `proto/**`, `db/migrations/**`, `db/query/**`, or `sqlc.yaml` / `buf.gen.yaml`:

```bash
task gen          # sqlc generate + buf generate
sqlc diff         # must be clean (CI runs this)
```

Then re-run `task server:test-short` (or full `task server:test`).

### When Go module deps change

```bash
task server:tidy                # go mod tidy
scripts/check-go-mod-tidy.sh    # CI parity (`Lint / Go`)
```

Commit `go.mod` / `go.sum` exactly as `go mod tidy` leaves them; CI fails when tidy would change either file.

### Optional quick compile check

```bash
# from server/
go test -c -o /dev/null ./...
# or package-scoped while iterating:
go test ./api/adminapi/ -count=1
```

## Testing notes

- **Unit tests**: prefer `sqlmock` for DB-facing logic when a real Postgres is unnecessary.
- **sqlmock expectations use sqlc's exported query constants**: `mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByID))`, never copied SQL or a fragment of it.
- **Integration tests**: use `internal/testutil` (Testcontainers PostgreSQL). They skip when Docker is unavailable or when `-short` is set.
- Prefer adding focused package tests next to the code under test (`*_test.go` in the same package or `_test` package as existing files do).
- Do not rely on a shared long-lived local DB for default unit tests; use mocks or Testcontainers helpers.

## Out of scope for this file

Env vars, storage backends, JWT details, and operator runbooks live in [README.md](README.md). Keep this guide to agent conventions and verification only.
