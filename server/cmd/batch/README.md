# batch

Every batch job ships in this single binary. The first argument names the job:

```bash
task server:build
./server/bin/batch aggregate-content-stats
```

Without an argument, or with a name that is not one of the nine below, the binary prints its usage to stderr and exits non-zero.

| Subcommand | Lifetime | What it does |
| --- | --- | --- |
| `publish-episodes` | Ticker, until `SIGINT` / `SIGTERM` | Promotes episodes whose scheduled time has passed |
| `project-episode-reads` | One-shot | Files the missing `episode_complete` events for stored `episode_reads` |
| `aggregate-content-stats` | One-shot | Rebuilds one calendar day of `content_daily_stats` per tenant |
| `aggregate-rankings` | One-shot | Rebuilds the daily and weekly `content_ranking_snapshots` |
| `purge-content-events` | One-shot | Deletes `content_events` rows past their retention window |
| `purge-ranking-snapshots` | One-shot | Deletes `content_ranking_snapshots` rows past their retention window |
| `purge-mfa-challenges` | One-shot | Deletes the spent admin MFA challenges whose tokens have expired |
| `purge-orphan-images` | One-shot | Deletes the image rows and storage objects nothing references |
| `build-recommend-features` | One-shot | Rebuilds the daily user and item recommend feature snapshots |

Each subcommand reads its own environment variables — the prefixes do not overlap — and owns its own lifecycle. OpenTelemetry reports `service.name` as `publira-<subcommand>`, still overridable with `OTEL_SERVICE_NAME`.

The container image carries the same binary, with the subcommand passed as a container argument:

```bash
task docker:build:batch
docker run --rm publira/batch:local purge-content-events
```

## publish-episodes

Promotes scheduled episodes on a ticker. It runs one pass on startup and then one per tick, and shuts down gracefully on `SIGINT` / `SIGTERM`.

```bash
go run ./server/cmd/batch publish-episodes
```

Environment variables:

- `PUBLIRA_DB_URL`: connection string. Defaults to the local development database.
- `PUBLIRA_PUBLISH_INTERVAL_SECONDS`: seconds between passes. Defaults to `60`; a non-numeric or non-positive value falls back to the default.
- `PUBLIRA_PUBLISH_MAX_RETRIES`: retries per episode. Defaults to `3`.

### Next.js revalidation

With `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_WEB_HOST_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, and `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` all set, the cache tags of every episode that reaches its publication time are sent to `POST /api/v1/revalidate` on all `web-*` apps.

## project-episode-reads

Files the analytics counterpart of every stored episode read that does not have one yet, across every tenant. It is safe to run at any cadence, including alongside the API, and running it again after it has caught up writes nothing.

```bash
eval "$(task --silent dev-env:env)"
go run ./server/cmd/batch project-episode-reads
```

Environment variables:

- `PUBLIRA_EPISODE_READ_PROJECTION_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_EVENTS_DB_URL`, then `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE`: rows per statement. Defaults to `1000`; anything that is not a positive 32-bit integer is rejected, because the value becomes a PostgreSQL `LIMIT`.

Run it before `aggregate-content-stats` for the same day. A late projection still files the event on the day the member finished, but only a rebuild of that day picks it up.

## aggregate-content-stats

Fully rebuilds `content_daily_stats` for one calendar day across every tenant, from `content_events` and the Phase 0 `purchases` table.

A day is the tenant's own: the window runs from that tenant's local midnight to the next, resolved from `tenants.timezone` (falling back to `platform_config.default_timezone`). So one run covers different instants for tenants in different zones, and a tenant whose stored zone cannot be loaded fails on its own without stopping the rest.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_STATS_DATE=2026-08-28 go run ./server/cmd/batch aggregate-content-stats
```

Environment variables:

- `PUBLIRA_CONTENT_STATS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_STATS_DATE`: the calendar date to rebuild as `YYYY-MM-DD`, read as each tenant's own local date. Unset rebuilds every tenant's own yesterday, which is not the same day for all of them.

The structured log records the target date, how many tenants the run finished, the rows created, and the elapsed time — on failure too, since each tenant commits on its own.

## aggregate-rankings

Rebuilds every tenant's ranking snapshots from the `content_daily_stats` rows `aggregate-content-stats` produces. One run writes four snapshots per tenant — a daily and a weekly leaderboard, each for series and for episodes — so run it after `aggregate-content-stats` for the same day.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_RANKING_DATE=2026-08-28 go run ./server/cmd/batch aggregate-rankings
```

Environment variables:

- `PUBLIRA_CONTENT_RANKING_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_RANKING_DATE`: last day of every window, as `YYYY-MM-DD`, read as each tenant's own local date. Unset ends every tenant's windows on its own yesterday.
- `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT`: how many entities one snapshot carries. Defaults to 50, and must be at least 1.

The structured log records the reference date, item limit, algorithm version, and how many tenants, snapshots, and items the run finished — on failure too, since each tenant commits on its own.

### Score formula

A snapshot ranks whatever `content_daily_stats` recorded over its window. Each daily row contributes

```text
1 × view_count
+ 2 × unique_viewer_count
+ 20 × purchase_count
+ 8 × favorite_count
+ 3 × max(rating_sum − 3 × rating_count, 0)
```

faded by `0.5 ^ (days before the last day of the window / 3)`, and an entity's score is the sum over its rows. Views are whatever `content_daily_stats` holds, which today is soft PV — a reader opening an episode or series detail page, reported through `RecordContentView`.

### Snapshot contract

Each row is one leaderboard, identified by `(tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version)`. A re-run replaces the row with that key in place; a run with a different `algorithm_version` writes alongside it.

| Column | Meaning |
| --- | --- |
| `ranking_key` | `daily` for a single day, `weekly` for the seven days ending on it |
| `period_start`, `period_end` | Inclusive calendar dates in the tenant's time zone. Equal for a daily ranking |
| `entity_type` | `series` or `episode`. A run writes both, and never mixes them in one row |
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
| `purchase_count`, `rating_count`, `rating_sum`, `favorite_count` | Remaining engagement totals over the window |
| `last_active_date` | Most recent day in the window that produced a daily stats row for this entity |

#### What a reader must tolerate

- **An empty leaderboard is the normal case, not an error.** A tenant with no traffic in the period, and every tenant before the first run, has nothing to show. Fall back to new releases.
- **A snapshot only holds the top `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT` entities.** An entity's absence means it did not place, not that it saw no engagement.
- **The entity may be gone.** `items` stores ids, and nothing keeps a snapshot in step with an unpublished or deleted series. Resolve the ids and drop what no longer exists.
- **A past period may be gone.** Retention keeps a bounded history — 90 days of daily snapshots and 400 of weekly ones by default — so a period further back than that has been purged. Only the newest period of a ranking key is guaranteed to be there.
- **The snapshot is up to a day stale**, and only as good as its input: a period whose `aggregate-content-stats` run never happened ranks the days that did run.
- **`algorithm_version` may not be the one you compiled against.** Scores are only comparable inside one row, so never compare a score across two snapshots or two versions.

## purge-content-events

Deletes `content_events` rows past their retention window across every tenant, in chunked `DELETE`s.

Raw events are dropped on a deadline (90 days by default) while the durable numbers live on in the `content_daily_stats` rows `aggregate-content-stats` builds.

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN=true go run ./server/cmd/batch purge-content-events
```

Environment variables:

- `PUBLIRA_CONTENT_EVENTS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`. The two batches that touch `content_events` run as the same `publira_content_stats` role.
- `PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS`: retention in days. Defaults to `90`. Anything below `1` fails at startup, because the cutoff would land at or after now and take the whole table.
- `PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `10000`.
- `PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN`: `true` counts the rows that would be deleted, logs the total, and exits without deleting anything.

The cutoff is the run's UTC timestamp minus `PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS`, compared exclusively (`occurred_at < cutoff`). The structured log records the cutoff, retention, chunk size, rows deleted, chunk count, and elapsed time.

## purge-ranking-snapshots

Deletes `content_ranking_snapshots` rows whose period fell out of its retention window, across every tenant, in chunked `DELETE`s.

`aggregate-rankings` files a new period rather than replacing the last one, so the table grows by four rows per tenant per day. Only the newest period is ever rendered; the rest exist for trend analysis, which is what the retention windows are sized for.

Retention is per `ranking_key`. A weekly snapshot compresses seven days into one row, so it earns a much longer window than a daily one:

| Ranking key | Default retention | What the window buys |
| --- | --- | --- |
| `daily` | 90 days | A quarter of day-over-day movement |
| `weekly` | 400 days | A year, plus the margin to compare a week against the same week a year earlier |

A snapshot expires when its `period_end` is before the cutoff for its `ranking_key` — the run's UTC date minus that key's retention, compared exclusively. **The newest period a tenant holds always survives, whatever the retention says**, and a `ranking_key` this build does not configure is never deleted at all.

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN=true go run ./server/cmd/batch purge-ranking-snapshots
```

Environment variables:

- `PUBLIRA_CONTENT_RANKING_DB_URL`: dedicated BYPASSRLS connection URL, shared with `aggregate-rankings`. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_RANKING_DAILY_RETENTION_DAYS`: retention for `daily` snapshots. Defaults to `90`. Anything below `1` fails at startup.
- `PUBLIRA_CONTENT_RANKING_WEEKLY_RETENTION_DAYS`: retention for `weekly` snapshots. Defaults to `400`. Anything below `1` fails at startup.
- `PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `1000`, an order of magnitude below the `content_events` chunk because a snapshot row carries a whole leaderboard.
- `PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN`: `true` counts the rows that would be deleted, logs the total, and exits without deleting anything.

The structured log records both cutoffs and retentions, the chunk size, the rows deleted, the chunk count, and the elapsed time.

The first run against a table that has accumulated since before this batch existed deletes a backlog rather than a day, so it takes many chunks. `PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN=true` reports how large that backlog is before anything is deleted.

## purge-mfa-challenges

Deletes `user_mfa_used_challenges` rows whose challenge token has expired, across every tenant, in chunked `DELETE`s.

A row there refuses the second exchange of an MFA challenge token, so it stops meaning anything once that token expires — five minutes after login. There is no retention setting: the cutoff is the run's UTC timestamp, compared against the row's own `expires_at` exclusively (`expires_at < cutoff`).

For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN=true go run ./server/cmd/batch purge-mfa-challenges
```

Environment variables:

- `PUBLIRA_MFA_CHALLENGE_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE`: row limit per `DELETE`. Defaults to `10000`.
- `PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN`: `true` counts the rows that would be deleted, logs the total, and exits without deleting anything.

The structured log records the cutoff, the chunk size, the rows deleted, the chunk count, and the elapsed time.

## purge-orphan-images

Deletes the image rows nothing points at and the storage objects nothing names, across every tenant.

The database is the authority over the bucket: an object no `*_image_variants` row names is garbage. A run has two halves, in this order. It deletes every `creator_images`, `label_images`, `series_images`, and `tenant_images` row that its entity no longer points at, and then walks the bucket under `tenants/` a page at a time, asking the database which of the keys on that page any variant still names and deleting the rest. Nothing younger than `PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS` is a candidate in either half, which is what keeps an upload still in flight out of range.

Both a database and a bucket are needed, so this is the one batch that also reads the `PUBLIRA_S3_*` settings. For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN=true go run ./server/cmd/batch purge-orphan-images
```

Environment variables:

- `PUBLIRA_ORPHAN_IMAGES_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_S3_BUCKET`, `PUBLIRA_S3_ENDPOINT`, `PUBLIRA_S3_FORCE_PATH_STYLE`, `AWS_REGION`: the bucket to sweep, read the same way every uploading process reads them. A missing bucket fails at startup.
- `PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS`: how old an object or image row must be to become a candidate. Defaults to `24`. Anything below `1` fails at startup, because the cutoff would land at or after now and put every upload in flight in range.
- `PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE`: objects per listing page, and with it the keys per reference lookup and per batch delete. Defaults to `1000`, which is S3's own page ceiling; a smaller value only adds round trips.
- `PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN`: `true` deletes nothing and reports the objects the sweep would remove. The row deletes are skipped too, so the count covers the objects already unreferenced rather than the ones this run would have stranded first.

The structured log records the cutoff, the minimum age, the page size, the bucket, the image rows deleted, the objects scanned and deleted, the page count, and the elapsed time.

## build-recommend-features

Rebuilds `user_recommend_features` and `item_recommend_features` for every tenant from a trailing window of daily engagement data. Online inference v1 reads these snapshots and falls back to rankings or new releases when a subject has no row.

Item features roll up `content_daily_stats`; user features summarise `content_events` for signed-in readers. Both tables are snapshots rather than ledgers: each run replaces one tenant's rows.

For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_RECOMMEND_FEATURES_DATE=2026-08-28 go run ./server/cmd/batch build-recommend-features
```

Environment variables:

- `PUBLIRA_RECOMMEND_FEATURES_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_RECOMMEND_FEATURES_DATE`: last day of the window, as `YYYY-MM-DD`, read as each tenant's own local date. Unset ends every tenant's window on its own yesterday.
- `PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS`: window length in days, ending on that date and including it. Defaults to 28, and must be at least 1.

Run it after `aggregate-content-stats` for the same day: the item snapshot reads the daily stats that batch produces.

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
| `purchase_count`, `rating_count`, `rating_sum`, `favorite_count` | Remaining engagement totals over the window |
| `active_days` | Days in the window that produced any daily stats row |
| `last_active_date` | Most recent such day |

`user_recommend_features.features`:

| Field | Meaning |
| --- | --- |
| `window_days`, `window_start`, `window_end` | The window this row summarises |
| `event_count` | Every event the reader produced in the window |
| `view_count` | `episode_view` plus `series_view` events |
| `purchase_count` | `purchase` events projected from `purchases` |
| `rating_count`, `rating_sum`, `favorite_count` | Remaining engagement totals |
| `series_count` | Distinct series the reader touched |
| `last_event_at` | Most recent event in the window |
| `top_series` | Up to ten series, most engaged first, each with the same per-series totals and its own `last_event_at`. Never null — an empty list when there is nothing to rank |

#### What a reader must tolerate

Neither table is complete, and an inference path that assumes otherwise breaks on ordinary traffic:

- **A missing row is the normal case, not an error.** A tenant that has never run the batch, a reader in their first session, and a series published after the window closed all have no row. Treat absence as "no signal" and fall back to the ranking snapshot or new releases.
- **Anonymous readers never have a row.** Signed-out traffic is always a fallback case.
- **Rows can disappear between runs.** A reader whose activity aged out of the window loses their row on the next build. Nothing about a previously present row is durable.
- **The snapshot is up to a day stale.** Same-day behaviour is out of scope for v1; a reader's very first sessions are invisible to it.
- **`feature_version` may not be the one you compiled against.** Read the value rather than assuming it, and treat an unexpected version as no signal.
