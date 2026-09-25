# publiractl

The command that operates a Publira install. It connects to PostgreSQL directly rather than through ConnectRPC, so it works on a deployment that serves no platform API. The first argument names a command group: `db` applies the database migrations and reports the schema version, `job` is the manual interface to the maintenance jobs, whose second argument names the job, `smtp` saves and tests the SMTP settings the platform's mail is sent with, and `tenant` creates and manages a tenant, its members, and its administrators in place of the Platform Console.

```bash
task server:build
./server/bin/publiractl db migrate
./server/bin/publiractl job aggregate-content-stats
./server/bin/publiractl tenant create --name "Example Comics" --domain comics.example.com --default-locale en
```

Without a command, with a command that is not one of these, with a subcommand that is not one of the ones below, or with an argument after it, the binary prints its usage to stderr and exits non-zero.

The container image carries the same binary, with the command passed as container arguments:

```bash
task docker:build:publiractl
docker run --rm -e PUBLIRA_DB_URL publira/publiractl:local db migrate
docker run --rm publira/publiractl:local job purge-content-events
```

## db

Applies `db/migrations/` to a database and reports what it holds, so a deployment brings its schema forward with the image it runs rather than with a separately installed golang-migrate CLI.

| Command | What it does |
| --- | --- |
| `db migrate` | Applies every pending migration and exits zero, also when there is nothing to apply. The structured log records the version it started from and the version it ended at. A dirty database is refused before anything runs |
| `db version` | Prints the version `schema_migrations` records (`0` for a database no migration has touched) and whether it is dirty |

```bash
eval "$(task --silent dev-env:env)"
go run ./server/cmd/publiractl db version
```

Environment variables:

- `PUBLIRA_DB_URL`: the connection that owns the schema. Required: unlike the `job` group, the `db` group reads no other variable and never falls back to the development URL, so an unset variable fails before connecting.
- `PUBLIRA_DB_MIGRATIONS_DIR`: the directory the migrations are read from. Defaults to `migrations` beside the binary, which is `/app/migrations` in the image, and when that does not exist, to the `db/migrations` of the checkout the command runs in, which is what `go run` uses.

River's own tables (`river_job`, `river_leader`, `river_migration`) are not in `db/migrations/`: the [worker](../worker/README.md) applies them with `rivermigrate` when it starts, and `db migrate` leaves them alone.

## smtp

Saves and tests the SMTP settings the worker sends the platform's mail with: the Platform Console's own mail, and the mail of every tenant that saves no SMTP settings of its own, tenant administrator invitations included. It does what `PlatformEmailSettingsService` does from the Platform Console, through the same implementation, `internal/platformsmtp`.

```bash
eval "$(task --silent dev-env:env)"
printf '%s' "$SMTP_PASSWORD" | go run ./server/cmd/publiractl smtp set \
  --host smtp.example.com \
  --port 587 \
  --encryption starttls \
  --username mailer \
  --from-address no-reply@example.com \
  --password-stdin
go run ./server/cmd/publiractl smtp test --to operator@example.com
```

| Command | RPC | What it does |
| --- | --- | --- |
| `smtp set` | `UpdatePlatformEmailSettings` | Replaces every saved setting with the flags given, so a `--reply-to` left out clears the saved one |
| `smtp show` | `GetPlatformEmailSettings` | Prints the saved settings and whether a password is saved, never the password |
| `smtp test` | `SendPlatformSmtpTestEmail` | Sends the console's test message through the saved settings to `--to`, and exits `1` when the server does not take it |

`smtp set` takes these flags:

| Flag | What it sets |
| --- | --- |
| `--host`, `--port` | The SMTP server. Required |
| `--encryption` | `tls` for a connection encrypted from the start, `starttls` for one upgraded after connecting, or `none`. Required |
| `--username` | The user the server is signed in to as. Required |
| `--from-address` | The address the mail is sent from. Required |
| `--reply-to` | The address replies go to, when it is not the sender's |

The password comes from a masked prompt or from stdin with `--password-stdin`, and is stored encrypted with the keys the servers decrypt it with. Left blank at the prompt, or not given where stdin is not a terminal, it keeps the saved one; the first save needs one. The worker reads the settings for every mail it sends, so a save reaches it without a restart.

`smtp set` files `platform_email_settings_updated` and every `smtp test` files `platform_smtp_test_email_sent` with its outcome, in `platform_audit_logs` under the `system` actor. A refused value names its flag on stderr and exits `1` with nothing written.

Environment variables:

- `PUBLIRA_PLATFORM_DB_URL`: the `publira_platform` connection the Platform Console's API writes with. Falls back to that role's development URL, never to `PUBLIRA_DB_URL`.
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`: encrypt the password `smtp set` stores, and decrypt the one `smtp test` sends with. Required by both: set the values the servers run with.

## tenant

Does to a tenant what `PlatformTenantService` does from the Platform Console, through the same implementation — `internal/platformtenants` and `internal/tenantmembers` — so every command writes the rows the corresponding RPC writes. Every command but `create` names its tenant with `--tenant`, by public ID or by domain.

```bash
eval "$(task --silent dev-env:env)"
go run ./server/cmd/publiractl tenant create \
  --name "Example Comics" \
  --domain comics.example.com \
  --default-locale en
go run ./server/cmd/publiractl tenant admin create \
  --tenant comics.example.com \
  --email owner@comics.example.com \
  --name Owner \
  --generate-password
```

| Command | RPC | What it does |
| --- | --- | --- |
| `tenant create` | `CreateTenant` | Creates a tenant on the platform's default time zone with the default creator roles, and invites every `--initial-admin-email` |
| `tenant show` | `GetTenant` | Prints the tenant |
| `tenant update` | `UpdateTenant` | Replaces the `--name`, `--domain`, or `--admin-domain` it is given and keeps the rest; `--admin-domain ""` goes back to the default console host |
| `tenant suspend`, `tenant resume` | `SuspendTenant`, `ResumeTenant` | Stops serving the tenant, and serves it again |
| `tenant member list` | `ListTenantMembers` | Prints every user holding a console role |
| `tenant member add` | `AddTenantMember` | Gives a user of the tenant, named by `--user` (public ID) or `--email`, the `--role` |
| `tenant member update-role` | `UpdateTenantMemberRole` | Replaces the `--user`'s console role with `--role` |
| `tenant member remove` | `RemoveTenantMember` | Takes every console role from the `--user`, who stays a user of the tenant |
| `tenant invite create` | `CreateTenantAdminInvitation` | Invites `--email` to administer the tenant; an address that already has an account is given `tenant_admin` at once |
| `tenant invite list` | `ListTenantAdminInvitations` | Prints every invitation with its ID and status |
| `tenant invite resend`, `tenant invite cancel` | `ResendTenantAdminInvitation`, `CancelTenantAdminInvitation` | Mails the invitation `--id` again with a new link, or withdraws it |
| `tenant admin create` | — | Creates a console account for `--email` with `--name` and `--role` (`tenant_admin` unless given), its email already verified, and sends no mail |

`tenant create` takes these flags:

| Flag | What it sets |
| --- | --- |
| `--name` | The tenant's name. Required |
| `--domain` | The host the tenant's site is served on. Required, and no other tenant may hold it |
| `--admin-domain` | The host the tenant's console is served on, when it is not the default one. No other tenant may hold it |
| `--default-locale` | The tenant's language, one of the supported locale codes. Required: nothing picks one for it |
| `--initial-admin-email` | An address to invite as the tenant's administrator. Repeat it for several; a repeated address is invited once |

`tenant admin create` is how an install that sends no mail gets its first administrator, and any later one. Its password comes from a masked prompt, from stdin with `--password-stdin`, or is generated with `--generate-password`, which prints it once to stdout and nowhere else. The account signs in to the console at once.

Each command prints what it did to stdout, and files its audit entries in `platform_audit_logs` under the `system` actor with no operator; the member commands file none, as their RPCs do not. A refused value names its flag on stderr and exits `1` with nothing written.

An invitation's mail goes on the outbox, as it does from the console, and the [worker](../publira/README.md#publira-worker) is what sends it. An install running no worker gets the invitation and sends nothing; an invitation's link expires 24 hours after it is created or resent.

Environment variables:

- `PUBLIRA_PLATFORM_DB_URL`: the `publira_platform` connection the Platform Console's API writes with. Falls back to that role's development URL, never to `PUBLIRA_DB_URL`.

## job

Nothing needs to schedule a job. The [worker](../worker/README.md) runs all ten jobs on its own schedule, catching up the days it missed after downtime, so a deployment that runs the worker has no cron entry or Kubernetes CronJob to set up. `publiractl job` is for what the schedule does not do: backfilling a named date, recovering after an incident, inspecting a purge with a dry run, a one-off pass, and debugging outside the resident worker. Each run rebuilds, purges, or closes once and exits.

Every job here is a thin invocation of `internal/maintenance`, and the worker registers the same ten jobs as River kinds over that package. So a backfill of a named date, a recovery after an incident, and a dry-run inspection run the implementation a scheduled pass runs, rather than a second copy of it that is free to diverge. A run here neither reads nor moves the worker's `daily_rebuild_progress`, and it may overlap a scheduled pass of the same job. The three dated rebuilds take a per-tenant advisory lock, so one of two overlapping runs waits for the other, and fails after 30 seconds, rather than both restating the same rows; the projection and the purges are safe to run twice at once, because the second finds nothing left to file or delete, and so is the royalty close, because a month is closed once and the second close of it finds it closed.

The worker's ticker jobs — publishing due episodes, applying free window boundaries, rolling a tenant's day, expiring pinned announcements — have no `job` subcommand. They act on every instant that has passed each time they run, including the first run after the worker starts, so there is nothing a manual run could do that the worker does not.

| Job | What it does |
| --- | --- |
| `project-episode-reads` | Files the missing `episode_complete` events for stored `episode_reads` |
| `aggregate-content-stats` | Rebuilds one calendar day of `content_daily_stats` per tenant |
| `aggregate-rankings` | Rebuilds the daily and weekly `content_ranking_snapshots`, tenant-wide and per genre |
| `purge-content-events` | Deletes `content_events` rows past their retention window |
| `purge-ranking-snapshots` | Deletes `content_ranking_snapshots` rows past their retention window |
| `purge-mfa-challenges` | Deletes the spent admin MFA challenges whose tokens have expired |
| `purge-withdrawn-comments` | Deletes the comments their authors withdrew past the retention window |
| `purge-orphan-images` | Deletes the image rows and storage objects nothing references |
| `build-recommend-features` | Rebuilds the daily user and item recommend feature snapshots |
| `close-royalty-statements` | Closes the royalty statements the tenants on automatic closing are owed |
| `sync-google-play-voided-purchases` | Takes back the purchases Google Play refunded in the last 30 days |

Each job reads its own environment variables — the prefixes do not overlap. OpenTelemetry reports `service.name` as `publira-<job>`, the name the worker's runs of the same job report as well, still overridable with `OTEL_SERVICE_NAME`.

## project-episode-reads

Files the analytics counterpart of every stored episode read that does not have one yet, across every tenant. It is safe to run at any cadence, including alongside the API, and running it again after it has caught up writes nothing.

```bash
eval "$(task --silent dev-env:env)"
go run ./server/cmd/publiractl job project-episode-reads
```

Environment variables:

- `PUBLIRA_EPISODE_READ_PROJECTION_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_EVENTS_DB_URL`, then `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE`: rows per statement. Defaults to `1000`; anything that is not a positive 32-bit integer is rejected, because the value becomes a PostgreSQL `LIMIT`.

Run it before `aggregate-content-stats` for the same day. A late projection still files the event on the day the member finished, but only a rebuild of that day picks it up.

## aggregate-content-stats

Fully rebuilds `content_daily_stats` for one calendar day across every tenant. Views, completions and ratings come from `content_events`; `purchase_count` from the Phase 0 `purchases` table and `comment_count` from `episode_comments`, which are the tables that own those facts.

A day is the tenant's own: the window runs from that tenant's local midnight to the next, resolved from `tenants.timezone` (falling back to `platform_config.default_timezone`). So one run covers different instants for tenants in different zones, and a tenant whose stored zone cannot be loaded fails on its own without stopping the rest.

The same transaction restates `tenant_rating_totals`, the tenant's all-time reaction points and completed reads over its series rows. It is the mean a series with few finished reads is rated against, and storing it here is what keeps the series page from summing the tenant's whole history on every read.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_STATS_DATE=2026-08-28 go run ./server/cmd/publiractl job aggregate-content-stats
```

Environment variables:

- `PUBLIRA_CONTENT_STATS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_STATS_DATE`: the calendar date to rebuild as `YYYY-MM-DD`, read as each tenant's own local date. Unset rebuilds every tenant's own yesterday, which is not the same day for all of them.

The structured log records the target date, how many tenants the run finished, the rows created, and the elapsed time — on failure too, since each tenant commits on its own.

## aggregate-rankings

Rebuilds every tenant's ranking snapshots from the `content_daily_stats` rows `aggregate-content-stats` produces. One run writes four tenant-wide snapshots per tenant — a daily and a weekly leaderboard, each for series and for episodes — plus a daily and a weekly series leaderboard for each of the tenant's genres, so run it after `aggregate-content-stats` for the same day. A genre's leaderboard ranks only its series that are published and rated all-ages at the time of the run, with the same score formula and item limit as the tenant-wide one.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_RANKING_DATE=2026-08-28 go run ./server/cmd/publiractl job aggregate-rankings
```

Environment variables:

- `PUBLIRA_CONTENT_RANKING_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_RANKING_DATE`: last day of every window, as `YYYY-MM-DD`, read as each tenant's own local date. Unset ends every tenant's windows on its own yesterday.
- `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT`: how many entities one snapshot carries. Defaults to 50, and must be at least 1.

The structured log records the reference date, item limit, algorithm version, and how many tenants, snapshots, and items the run finished — on failure too, since each tenant commits on its own.

### Snapshot contract

Each row is one leaderboard, identified by `(tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version, genre_id)`. A re-run replaces the row with that key in place; a run with a different `algorithm_version` writes alongside it.

| Column | Meaning |
| --- | --- |
| `ranking_key` | `daily` for a single day, `weekly` for the seven days ending on it |
| `period_start`, `period_end` | Inclusive calendar dates in the tenant's time zone. Equal for a daily ranking |
| `entity_type` | `series` or `episode`. A run writes both, and never mixes them in one row |
| `genre_id` | The genre this leaderboard ranks, always with `entity_type` `series`. `NULL` for the tenant-wide leaderboard. Deleting the genre deletes its rows |
| `algorithm_version` | The score formula this row was built with. Read it rather than assuming it |
| `items` | The leaderboard, best first. Never null — an empty array when there is nothing to rank |
| `computed_at` | When this row was last written |

Each entry of `items`:

| Field | Meaning |
| --- | --- |
| `rank` | Position, starting at 1 |
| `entity_id` | The series or episode, per the row's `entity_type` |
| `score` | The faded weighted score, rounded to four decimals. Comparable within one row, and nowhere else |
| `view_count` | Views over the window |
| `viewer_days` | Sum of the daily unique viewer counts. A reader who returns on five days counts five times — this is not a window-wide distinct count |
| `purchase_count`, `rating_count`, `rating_sum`, `favorite_count`, `comment_count` | Remaining engagement totals over the window |
| `last_active_date` | Most recent day in the window that produced a daily stats row for this entity |

#### What a reader must tolerate

- **An empty leaderboard is the normal case, not an error.** A tenant with no traffic in the period, and every tenant before the first run, has nothing to show. Fall back to new releases.
- **A snapshot only holds the top `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT` entities.** An entity's absence means it did not place, not that it saw no engagement.
- **The entity may be gone.** `items` stores ids, and nothing keeps a snapshot in step with an unpublished or deleted series. Resolve the ids and drop what no longer exists.
- **A past period may be gone.** Retention keeps a bounded history — 90 days of daily snapshots and 400 of weekly ones unless the platform or the tenant sets otherwise — so a period further back than that has been purged. Only the newest period of a ranking key, per entity type and genre, is guaranteed to be there.
- **The snapshot is up to a day stale**, and only as good as its input: a period whose `aggregate-content-stats` run never happened ranks the days that did run.
- **`algorithm_version` may not be the one you compiled against.** Scores are only comparable inside one row, so never compare a score across two snapshots or two versions.

## Retention periods

`purge-content-events`, `purge-ranking-snapshots`, and `purge-withdrawn-comments` read how long to keep each tenant's rows from the database at the start of every run, not from the environment. A tenant's period is its own override in `tenant_retention_settings` (`TenantSettingsService.UpdateTenantRetentionSettings`), else the platform default in `platform_retention_config` (`PlatformPolicyService.UpdatePlatformRetentionDefaults`), else the built-in default:

| Period                   | Built-in default |
| ------------------------ | ---------------- |
| Withdrawn comments       | 180 days         |
| Content events           | 90 days          |
| Daily ranking snapshots  | 90 days          |
| Weekly ranking snapshots | 400 days         |

Every period is from 1 to 36500 days. The jobs' role, `publira_content_stats`, may read `platform_retention_config` and nothing else under the `platform_` prefix.

## purge-content-events

Deletes `content_events` rows past their tenant's retention period, one tenant at a time, in chunked `DELETE`s.

Raw events are dropped on a deadline (90 days unless the platform or the tenant sets otherwise) while the durable numbers live on in the `content_daily_stats` rows `aggregate-content-stats` builds.

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN=true go run ./server/cmd/publiractl job purge-content-events
```

Environment variables:

- `PUBLIRA_CONTENT_EVENTS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`. The two jobs that touch `content_events` run as the same `publira_content_stats` role.
- `PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `10000`.
- `PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN`: `true` counts the rows that would be deleted, logs the total, and exits without deleting anything.

A tenant's cutoff is the run's UTC timestamp minus its content-event retention period (see [Retention periods](#retention-periods)), compared exclusively (`occurred_at < cutoff`). One tenant's failure does not stop the others. The structured log records the run's timestamp, the default period, how many tenants override it, the chunk size, the tenants drained, rows deleted, chunk count, and elapsed time.

## purge-ranking-snapshots

Deletes `content_ranking_snapshots` rows whose period fell out of its tenant's retention period, one tenant at a time, in chunked `DELETE`s.

`aggregate-rankings` files a new period rather than replacing the last one, so the table grows by four rows per tenant per day, plus two per genre. Only the newest period is ever rendered; the rest exist for trend analysis, which is what the retention periods are sized for.

Retention is per `ranking_key` (see [Retention periods](#retention-periods)). A weekly snapshot compresses seven days into one row, so it earns a much longer period than a daily one:

| Ranking key | Built-in retention | What the period buys |
| --- | --- | --- |
| `daily` | 90 days | A quarter of day-over-day movement |
| `weekly` | 400 days | A year, plus the margin to compare a week against the same week a year earlier |

A snapshot expires when its `period_end` is before the cutoff for its `ranking_key` — the run's UTC date minus the tenant's period for that key, compared exclusively. Genre leaderboards expire on the same cutoffs as the tenant-wide ones. **The newest period a tenant holds for each ranking key, entity type, and genre always survives, whatever the retention says**, and a `ranking_key` this build does not configure is never deleted at all.

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN=true go run ./server/cmd/publiractl job purge-ranking-snapshots
```

Environment variables:

- `PUBLIRA_CONTENT_RANKING_DB_URL`: dedicated BYPASSRLS connection URL, shared with `aggregate-rankings`. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `1000`, an order of magnitude below the `content_events` chunk because a snapshot row carries a whole leaderboard.
- `PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN`: `true` counts the rows that would be deleted, logs the total, and exits without deleting anything.

One tenant's failure does not stop the others. The structured log records the run's timestamp, both default periods, how many tenants override them, the chunk size, the tenants drained, the rows deleted, the chunk count, and the elapsed time.

The first run against a table that has accumulated since before this job existed deletes a backlog rather than a day, so it takes many chunks. `PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN=true` reports how large that backlog is before anything is deleted.

## purge-mfa-challenges

Deletes `user_mfa_used_challenges` rows whose challenge token has expired, across every tenant, in chunked `DELETE`s.

A row there refuses the second exchange of an MFA challenge token, so it stops meaning anything once that token expires — five minutes after login. There is no retention setting: the cutoff is the run's UTC timestamp, compared against the row's own `expires_at` exclusively (`expires_at < cutoff`).

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN=true go run ./server/cmd/publiractl job purge-mfa-challenges
```

Environment variables:

- `PUBLIRA_MFA_CHALLENGE_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `10000`.
- `PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN`: `true` counts the rows that would be deleted, logs the total, and exits without deleting anything.

The structured log records the cutoff, the chunk size, the rows deleted, the chunk count, and the elapsed time.

## purge-withdrawn-comments

Deletes the `episode_comments` rows whose authors withdrew them longer ago than their tenant's retention period allows, one tenant at a time, in chunked `DELETE`s. The reports filed on a deleted comment go with it, through the foreign key from `episode_comment_reports`.

A withdrawal is the author's own deletion, and the row outlives it only so staff can still read the comment while a report or a dispute about it is open. A tenant's cutoff is the run's UTC timestamp minus its withdrawn-comment retention period (see [Retention periods](#retention-periods)), compared exclusively (`withdrawn_at < cutoff`).

**A `hidden` comment is never deleted, whatever its age**: a removal by staff or by the report threshold is the record of a moderation decision, and nothing here takes it away.

The admin console resolves the same period to show staff the `purge_due_at` of a withdrawn comment.

One tenant's failure does not stop the others: the run finishes the remaining tenants and then exits non-zero with every failure in its log.

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_COMMENT_PURGE_DRY_RUN=true go run ./server/cmd/publiractl job purge-withdrawn-comments
```

Environment variables:

- `PUBLIRA_COMMENT_PURGE_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_COMMENT_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `1000`, below the `content_events` chunk because deleting a comment cascades into the reports filed on it.
- `PUBLIRA_COMMENT_PURGE_DRY_RUN`: `true` counts the comments that would be deleted, logs the total, and exits without deleting anything.

The structured log records the run's timestamp, the default period, how many tenants override it, the chunk size, the tenants drained, the rows deleted, the chunk count, and the elapsed time.

## purge-orphan-images

Deletes the image rows nothing points at and the storage objects nothing names, across every tenant.

The database is the authority over the bucket: an object no `*_image_variants` row names is garbage. A run has two halves, in this order. It deletes every `creator_images`, `label_images`, `series_images`, and `tenant_images` row that its entity no longer points at, and then walks the bucket under `tenants/` a page at a time, asking the database which of the keys on that page any variant still names and deleting the rest. Nothing younger than `PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS` is a candidate in either half, which is what keeps an upload still in flight out of range.

Both a database and a bucket are needed. The bucket is the one saved in the platform's settings, read on the same connection; with none saved the run fails before deleting anything. For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN=true go run ./server/cmd/publiractl job purge-orphan-images
```

Environment variables:

- `PUBLIRA_ORPHAN_IMAGES_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`: decrypt the access key of an object store saved with one.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`: the ambient credential for an object store saved without an access key.
- `PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS`: how old an object or image row must be to become a candidate. Defaults to `24`. Anything below `1` fails at startup, because the cutoff would land at or after now and put every upload in flight in range; so does an age beyond `2562047`, which wraps negative into that same cutoff.
- `PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE`: objects per listing page, and with it the keys per reference lookup and per batch delete. Defaults to `1000`, which is S3's own page ceiling; a smaller value only adds round trips.
- `PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN`: `true` deletes nothing and reports the objects the sweep would remove. The row deletes are skipped too, so the count covers the objects already unreferenced rather than the ones this run would have stranded first.

The structured log records the cutoff, the minimum age, the page size, the bucket, the image rows deleted, the objects scanned and deleted, the page count, and the elapsed time.

## build-recommend-features

Rebuilds `user_recommend_features` and `item_recommend_features` for every tenant from a trailing window of daily engagement data. Online inference v1 reads these snapshots and falls back to rankings or new releases when a subject has no row.

Item features roll up `content_daily_stats`; user features summarise `content_events` for signed-in readers. Both tables are snapshots rather than ledgers: each run replaces one tenant's rows.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_RECOMMEND_FEATURES_DATE=2026-08-28 go run ./server/cmd/publiractl job build-recommend-features
```

Environment variables:

- `PUBLIRA_RECOMMEND_FEATURES_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_RECOMMEND_FEATURES_DATE`: last day of the window, as `YYYY-MM-DD`, read as each tenant's own local date. Unset ends every tenant's window on its own yesterday.
- `PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS`: window length in days, ending on that date and including it. Defaults to 28, and must be at least 1.

Run it after `aggregate-content-stats` for the same day: the item snapshot reads the daily stats that job produces.

The structured log records the reference date, window, feature version, and how many tenants and user and item rows the run finished — on failure too, since each tenant commits on its own.

### Feature contract

Both tables carry `feature_version`, the version of the code that wrote the row.

`window_start` and `window_end` are inclusive calendar dates in the tenant's time zone; `last_event_at` is an ISO 8601 UTC timestamp, because it names an instant rather than a day.

`item_recommend_features.features`:

| Field | Meaning |
| --- | --- |
| `window_days`, `window_start`, `window_end` | The window this row summarises |
| `view_count` | Views over the window |
| `viewer_days` | Sum of the daily unique viewer counts. A reader who returns on five days counts five times — this is not a window-wide distinct count |
| `purchase_count`, `rating_count`, `rating_sum`, `favorite_count`, `comment_count` | Remaining engagement totals over the window |
| `active_days` | Days in the window that produced any daily stats row |
| `last_active_date` | Most recent such day |

`user_recommend_features.features`:

| Field | Meaning |
| --- | --- |
| `window_days`, `window_start`, `window_end` | The window this row summarises |
| `event_count` | Every event the reader produced in the window |
| `view_count` | `episode_view` plus `series_view` events |
| `purchase_count` | `purchase` events projected from `purchases` |
| `rating_count`, `rating_sum`, `favorite_count`, `comment_count` | Remaining engagement totals |
| `series_count` | Distinct series the reader touched |
| `last_event_at` | Most recent event in the window |
| `top_series` | Up to ten series, most engaged first, each with the same per-series totals and its own `last_event_at`. Never null — an empty list when there is nothing to rank |

#### What a reader must tolerate

Neither table is complete, and an inference path that assumes otherwise breaks on ordinary traffic:

- **A missing row is the normal case, not an error.** A tenant the job has never run for, a reader in their first session, and a series published after the window closed all have no row. Treat absence as "no signal" and fall back to the ranking snapshot or new releases.
- **Anonymous readers never have a row.** Signed-out traffic is always a fallback case.
- **Rows can disappear between runs.** A reader whose activity aged out of the window loses their row on the next build. Nothing about a previously present row is durable.
- **The snapshot is up to a day stale.** Same-day behaviour is out of scope for v1; a reader's very first sessions are invisible to it.
- **`feature_version` may not be the one you compiled against.** Read the value rather than assuming it, and treat an unexpected version as no signal.

## close-royalty-statements

Closes, for every tenant that chose automatic closing, each month whose close day has come and that has no statement yet. A tenant closing by hand is never touched.

A month is owed when two things hold in the tenant's own zone: today is on or after the close day (`auto_close_day`) of the month after it, and the month ended after the tenant chose automatic closing (`automatic_since`). So a run closes every owed month still open, oldest first, which includes the months a missed run left behind, and a month that ended before the choice stays the tenant's to close by hand. The close is the one the console's close button runs, and it writes the same audit entry, under the `system` role and with no user.

A month someone closed by hand, before the run or during it, stays as it was closed: a month has one statement, so the run's close of it fails and is logged as already closed.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
go run ./server/cmd/publiractl job close-royalty-statements
```

Environment variables:

- `PUBLIRA_CONTENT_STATS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_DB_URL`.

The structured log records, per tenant, each month closed with its totals, a month already closed, the previous month when its close day has not come (`due_on`), and a tenant skipped because the previous month ended before automatic closing began; then how many tenants the run went through, how many months it closed, and the elapsed time. One tenant's failure does not stop the others: the run finishes the remaining tenants and then exits non-zero.

## sync-google-play-voided-purchases

Reads, for every tenant whose Google Play store is enabled and names its app, the purchases Google Play voided in the last 30 days — the whole window its Voided Purchases API keeps — and takes each one back the way a Stripe refund is taken back. A voided purchase the app never confirmed is held in `unapplied_store_refunds` until it is. Running it again changes nothing.

```bash
eval "$(task --silent dev-env:env)"
go run ./server/cmd/publiractl job sync-google-play-voided-purchases
```

Environment variables:

- `PUBLIRA_CONTENT_STATS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_DB_URL`.
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`: decrypt the service account key each tenant saved.

The structured log records each tenant that failed, then how many tenants the run went through, how many voided purchases it read, how many of them had no purchase yet, and the elapsed time. One tenant's failure does not stop the others: the run finishes the remaining tenants and then exits non-zero.
