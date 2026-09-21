# worker

The long-lived background process. It hosts one River client, on which it drains the Outbox and processes the entries as jobs, runs the four [periodic jobs](#periodic-jobs), and owns the nine [maintenance jobs](#maintenance-jobs) that rebuild and purge stored data. It runs as a separate process from the API processes. Besides `outbox_test`, the Outbox drain handles these email events:

| Event type | Mail |
| --- | --- |
| `tenant_admin_invitation_email` | Tenant administrator invitation |
| `platform_password_reset_email` | Platform Console password reset |
| `platform_email_change_confirmation_email` | Platform Console email change confirmation, one event per address to confirm |
| `platform_email_changed_notice_email` | Platform Console notice to the previous address once the change completes |
| `reader_email_verification_email` | Reader sign-up address verification |
| `reader_email_change_confirmation_email` | Reader email change confirmation, one event per address to confirm |
| `reader_email_changed_notice_email` | Reader notice to the previous address once the change completes |
| `reader_password_reset_email` | Reader password reset |
| `reader_password_changed_notice_email` | Reader notice that the password on the account was changed |
| `reader_signup_attempt_notice_email` | Reader notice that a sign-up was attempted with an address that already has an account |
| `admin_password_reset_email` | Admin console password reset |
| `admin_email_change_confirmation_email` | Admin console email change confirmation, one event per address to confirm |
| `admin_email_changed_notice_email` | Admin console notice to the previous address once the change completes |

It also handles these non-mail events:

| Event type | Side effect |
| --- | --- |
| `member_push_notification` | The FCM or Web Push delivery that mirrors a member's `notifications` row, one message per registered device |
| `comment_awaiting_approval_notification` | A `notifications` row for every member of the tenant's staff, saying that one episode has comments waiting in the approval queue |
| `comment_reported_notification` | The same, for an episode whose comments readers have reported |
| `announcement_notification` | A `notifications` row for every reader one posted announcement addresses — every user of the tenant on a broadcast, the single named recipient on a targeted one |
| `next_cache_revalidation` | The `POST /api/v1/revalidate` to each `web-*` app that drops the cache tags one write left stale |

The push handler is registered when either Firebase or Web Push credentials are configured; see [Main environment variables](#main-environment-variables).

Both comment events are keyed by the episode and the hour they arrived in, so an episode a hundred readers comment on within the hour produces one alert rather than a hundred. The window is held by `outbox_events.idempotency_key`, which is why a burst writes a single row here, and by the notification's own `(user_id, notification_type, subject_key)`, which is why a redelivered event writes no second row for anyone.

The platform console rows carry no `tenant_id`: their handlers resolve the platform SMTP settings and the platform default locale and time zone rather than a tenant's. The reader and admin console rows name a tenant: the reader links point at that tenant's own domain, and the admin console links at its admin domain.

## What a mail is made of

Every mail's subject line and plain-text body are composed here, out of `locales/*.json`. `PUBLIRA_EMAIL_RENDERER_URL` decides the rest, and a deployment gets one of exactly two mails:

| `PUBLIRA_EMAIL_RENDERER_URL` | What is delivered |
| --- | --- |
| Set | A `multipart/alternative` message whose HTML part is the email-renderer's output |
| Unset | A `text/plain` message, and no call to the renderer |

There is no default URL. A deployment that does not run the renderer sends readable mail rather than retrying every mail event until the row goes `dead`, and a renderer that is configured but down or answering with no HTML is a failed attempt the worker repeats — never a mail silently downgraded to text.

## Periodic jobs

Some jobs have to act the moment a stored instant passes rather than on a schedule someone invokes, so River enqueues them on an interval and this process runs them:

| Kind | Interval variable | What it does |
| --- | --- | --- |
| `ticker.publish_episodes` | `PUBLIRA_PUBLISH_INTERVAL_SECONDS` | Promotes every episode whose scheduled time has passed |
| `ticker.apply_free_windows` | `PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS` | Records the drop of the public site caches at both ends of every scheduled episode free window |
| `ticker.roll_tenant_day` | `PUBLIRA_TENANT_DAY_INTERVAL_SECONDS` | Records the drop of the cache entries whose answer is a tenant's own calendar day, at that tenant's midnight |
| `ticker.expire_pinned_announcements` | `PUBLIRA_PINNED_ANNOUNCEMENT_INTERVAL_SECONDS` | Clears `announcements.pinned` once `pinned_until` has passed, and records the drop of the tag the site holds its banner under |

They run on a River queue of their own (`ticker`, one worker each) rather than the default one the Outbox drain is sized for: one pass is long and rare where an outbox job is short and constant, so a publish walking every tenant with retries must not hold a worker the drain is counting on.

Each runs once when the client starts and then once per interval, so a deployment that was down over a scheduled time, a window boundary, or a midnight catches up as soon as it comes back. Each is unique over River's in-flight states, so a second instance of this worker enqueues no second copy and a pass that outlasts its own interval is not started again underneath itself. A due run is a `river_job` row, which is where to look for one rather than in a process's log.

A window needs no job to take effect in the API: the access predicates compare the stored period against the current instant, so an episode inside a free window answers as free from the moment it opens. What the job fixes is what the web apps cached before that. Each end of a window is recorded once its drop is owed — a `next_cache_revalidation` row this worker then sends — so a boundary crossed while this process was down is applied on the next pass instead of leaving the site on the side of the window it has left.

Which midnight `ticker.roll_tenant_day` answers to is the tenant's, resolved from `tenants.timezone` (falling back to `platform_config.default_timezone`), so one pass turns over a tenant in Tokyo hours before one in Los Angeles. The tag is `tenant:<id>:today`, and only the storefront's weekly schedule carries it. Which day each tenant was last rolled on is remembered in the process rather than in a column: a drop is idempotent, so a restart costs one extra drop of one narrow tag per tenant, which is why the first pass after startup turns every tenant over.

A pinned announcement needs no job to stop being answered either: the banner read compares `pinned_until` against the current instant. What the job fixes is the band a site cached, and clearing the flag is what records the boundary as applied, so a window that closed while this process was down is taken down on the next pass. The flag is cleared once the drop is owed, for the reason the free window's boundary is. The tag is `tenant:<id>:announcements:pinned`, which only the banner carries; the console drops the same tag when an operator pins or unpins one.

They connect as `publira_ticker` rather than on the pool above. The worker's own login owns River's schema and therefore holds `CREATE` on the `public` schema, which is the one privilege these jobs must not have.

## Maintenance jobs

The rebuild and purge work runs here as well, on the same River client:

| Kind | What it does |
| --- | --- |
| `maintenance.project_episode_reads` | Files the missing `episode_complete` events for stored `episode_reads` |
| `maintenance.aggregate_content_stats` | Rebuilds each day of `content_daily_stats` a tenant is owed |
| `maintenance.aggregate_rankings` | Rebuilds the daily and weekly `content_ranking_snapshots` of each day a tenant is owed |
| `maintenance.build_recommend_features` | Rebuilds the user and item recommend feature snapshots |
| `maintenance.purge_content_events` | Deletes `content_events` rows past their retention window |
| `maintenance.purge_ranking_snapshots` | Deletes `content_ranking_snapshots` rows past their retention window |
| `maintenance.purge_mfa_challenges` | Deletes the spent admin MFA challenges whose tokens have expired |
| `maintenance.purge_withdrawn_comments` | Deletes the comments their authors withdrew past the retention window |
| `maintenance.purge_orphan_images` | Deletes the image rows and storage objects nothing references |

Each kind is a thin wrapper around `internal/maintenance`, which is the same implementation [`batch`](../batch/README.md) invokes for an explicit operator run — a backfill of a named date, a recovery after an incident, a dry-run purge. A pass only the schedule could reach would be a second copy of the maintenance, free to diverge from the one an operator recovers with.

The first four are one chain, in this order, and only its head is scheduled: `maintenance.project_episode_reads` runs when the client starts and then once an hour, and each link enqueues the next when its pass ends. Hourly is how soon a tenant's day is rebuilt after it ends, since each tenant's midnight falls on a different hour.

How far the chain has got is recorded per tenant in `daily_rebuild_progress`, in that tenant's own calendar days:

| Link | Rebuilds, for each tenant |
| --- | --- |
| `maintenance.project_episode_reads` | Every pending read, then records when the pass began. A tenant the table has no row for starts its chain on its own yesterday |
| `maintenance.aggregate_content_stats` | Each day after `content_stats_through` whose end came before that recorded instant, so no read finished on it is filed after its stats. A day that began before the tenant's content event retention cutoff has lost its events, so it is logged as missing and passed over rather than rebuilt from what is left |
| `maintenance.aggregate_rankings` | Each day after `rankings_through`, up to `content_stats_through` |
| `maintenance.build_recommend_features` | The day at `rankings_through`, once it has moved past `recommend_features_through`. The feature tables hold one snapshot per tenant, so the days in between are not built |

So a worker that was down for days rebuilds each of them on its return, in order, and a link never reads a day the one before it has not finished. A day that fails stops that tenant's progress there: the other tenants carry on, the job is recorded as failed and retried, and the next pass starts again on the day that failed rather than after it. A run of [`batch`](../batch/README.md) neither reads nor moves this record.

Each purge is scheduled on its own, runs when the client starts, and then once per interval:

| Kind                                   | Interval |
| -------------------------------------- | -------- |
| `maintenance.purge_content_events`     | 24 hours |
| `maintenance.purge_ranking_snapshots`  | 24 hours |
| `maintenance.purge_mfa_challenges`     | 1 hour   |
| `maintenance.purge_withdrawn_comments` | 1 hour   |
| `maintenance.purge_orphan_images`      | 24 hours |

A purge needs no record of what it missed: one pass deletes everything past its cutoff at the moment it runs, so the first pass after downtime drains every row that expired in the meantime. Each is also unique over a run that completed in its current interval, counted from the epoch rather than from the process start, so a restart runs a purge only when none has finished in that interval yet — which is what keeps a deploy from being a sweep of the whole bucket. A pass that failed for good does not count, and the next restart or interval tries again.

They run on a queue of their own (`maintenance`) for the reason the ticker jobs do, and then some: a rebuild walks every tenant and a purge deletes in chunks until a table is drained. The queue runs one pass at a time, because these share one database with every request the platform is serving. Each kind is unique over River's in-flight states, so a second instance of this worker enqueues no second copy, and a failed pass is retried three times rather than dropped: every one of them is idempotent, so a pass lost to a connection drop is worth running again.

They connect as `publira_content_stats`, the role the batch subcommands have always used for this work, on a third pool. What the work may reach is decided by the role, and hosting three kinds of job in one process is not a reason for any of them to borrow another's privileges.

`maintenance.purge_orphan_images` is the one that reaches past the database. It sweeps the bucket saved in the platform's settings, resolved when a run starts, so the worker starts before one is saved; a run on a platform with none is cancelled with that reason rather than retried.

## Running

From the repository root:

```bash
task server:dev-worker
```

From the `server` directory:

```bash
go run ./cmd/worker
```

Using a pre-built binary:

```bash
task server:build
./server/bin/worker
```

The production image uses the API role (a long-lived HTTP process).

```bash
task docker:build:api CMD_NAME=worker PORT=8003
```

## Main environment variables

The connection uses `publira_outbox`, the BYPASSRLS login the baseline seed creates for this process, in every environment. `PUBLIRA_DB_URL` is not a fallback: it is the superuser connection locally and the migration tooling's connection in production, so an unset variable fails to authenticate rather than quietly granting the worker more privilege.

- `PUBLIRA_WORKER_DB_URL` (optional; falls back to the development default `postgres://publira_outbox:outboxpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_TICKER_DB_URL` (optional; the periodic jobs' own connection, falling back to `postgres://publira_ticker:tickerpass@db:5432/publira?sslmode=disable` and never to `PUBLIRA_DB_URL`)
- `PUBLIRA_CONTENT_STATS_DB_URL` (optional; the maintenance jobs' own connection, falling back to `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` and never to `PUBLIRA_DB_URL`)
- `PUBLIRA_WORKER_ADDR` (optional, default `:8003`. Serves `/livez` and `/readyz`)
- `PUBLIRA_OUTBOX_DRAIN_INTERVAL` (optional, a Go duration. Default `2s`)
- `PUBLIRA_OUTBOX_CLAIM_LIMIT` (optional, the maximum number of rows claimed per drain. Default `100`)
- `PUBLIRA_OUTBOX_MAX_ATTEMPTS` (optional, default `10`. The failure count at which an entry becomes `dead`)
- `PUBLIRA_OUTBOX_STALE_PROCESSING` (optional, a Go duration. Default `15m`. A `processing` row older than this is returned to `pending`. For the auth mail above the reclaim also counts as a failed attempt, so this duration times `PUBLIRA_OUTBOX_MAX_ATTEMPTS` bounds how long a crash loop can keep the row's raw token)
- `PUBLIRA_OUTBOX_MAX_WORKERS` (optional, the concurrency of River's default queue, which the Outbox drain has to itself. Default `8`)
- `PUBLIRA_PUBLISH_INTERVAL_SECONDS` / `PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS` / `PUBLIRA_TENANT_DAY_INTERVAL_SECONDS` / `PUBLIRA_PINNED_ANNOUNCEMENT_INTERVAL_SECONDS` (optional, seconds between the passes of each periodic job. Default `60`; a non-numeric or non-positive value falls back to it. Each one bounds how long the site can stay on the wrong side of the instant its job answers to)
- `PUBLIRA_PUBLISH_MAX_RETRIES` (optional, retries per episode within one `ticker.publish_episodes` pass. Default `3`)
- `PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE`, `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT`, `PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS`, `PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE`, `PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE`, `PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE`, `PUBLIRA_COMMENT_PURGE_CHUNK_SIZE`, `PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS`, `PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE` (optional, the maintenance jobs' tunables, documented per job in [batch](../batch/README.md). They are read once at startup, so a value that is not a positive whole number stops the process with the variable's name. The dated rebuild and dry-run variables are not read here: they control one invocation rather than a deployment, so they belong to `batch`)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (optional, the ambient credential `maintenance.purge_orphan_images` signs with when the platform's object store is saved without an access key)
- `PUBLIRA_EMAIL_RENDERER_URL` (optional, the URL of the email-renderer that renders the HTML part of the emails above. Unset, the mail goes out as text alone; see [What a mail is made of](#what-a-mail-is-made-of))
- `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_WEB_HOST_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (optional, where `next_cache_revalidation` sends cache tags: `POST /api/v1/revalidate` on each `web-*` app. A worker without them retries every such event until an operator restarts it with them, because the drop is owed whoever wrote it)
- `PUBLIRA_PLATFORM_APP_URL` (optional, the base URL the Platform Console links in the platform auth mail are built from. `http://platform.localhost:3080` when unset)
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional, the keys used to decrypt the SMTP password, the object store's access key, and the Web Push VAPID private key. Set the same values as the platform API)
- `PUBLIRA_FCM_PROJECT_ID` / `PUBLIRA_FCM_CREDENTIALS_JSON` (optional, the Firebase project and service account key the mobile push is sent with. `GOOGLE_APPLICATION_CREDENTIALS` is the path form of the same key. Any one of the three turns mobile push on — the project id counts alone, because Application Default Credentials also resolves a well-known `gcloud` file and an instance's attached service account, neither of which sets a credential variable. With none of them set, every mobile delivery of `member_push_notification` fails. Web Push takes no variable: it signs with the platform's stored VAPID key pair once an operator has saved a subject, see [Web Push](../../README.md#web-push))
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

River's schema (`river_job` and the rest) is applied with `rivermigrate` at startup, which is why `publira_outbox` holds `CREATE` on the `public` schema. `/readyz` names one check per pool — `db.outbox`, `db.ticker`, and `db.content_stats` — so a failure says which login stopped answering.

## Logs and metrics

OpenTelemetry reports `service.name` as `publira-worker` for the process, and a name of its own for the span each job's run hangs off: `publira-publish-episodes`, `publira-apply-free-windows`, `publira-roll-tenant-day`, or `publira-expire-pinned-announcements` for a periodic run, and `publira-<subcommand>` for a maintenance run — `publira-aggregate-content-stats` and the rest. They are the names those jobs report where they still have a process of their own, so a trace UI filtering on one keeps finding the same work.

The structured logs (slog) carry `event_id` / `event_type` / `idempotency_key` / `attempts`. The OpenTelemetry counters are:

- `publira.outbox.events.claimed`
- `publira.outbox.events.done`
- `publira.outbox.events.retry`
- `publira.outbox.events.dead`
- `publira.outbox.handler.duration` (histogram, seconds)

They are no-ops when there is no MeterProvider.

## Processing flow

1. Claim due `pending` rows with `FOR UPDATE SKIP LOCKED` and enqueue the River jobs in the same transaction
2. The job runs the handler: `done` on success, or back to `pending` with exponential backoff on failure
3. `dead` on reaching the maximum attempt count or on a permanent error
4. After a process restart, unprocessed `pending` rows and stale `processing` rows are picked up again. A crash records no failure, so for the auth mail above the reclaim spends an attempt: a worker dying on every attempt eventually reaches `dead`, where the raw token is dropped from `payload`
