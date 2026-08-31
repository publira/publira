# batch

Every batch job ships in this single binary. The first argument names the job:

```bash
task server:build
./server/bin/batch aggregate-content-stats
```

Without an argument, or with a name that is not one of the five below, the binary prints its usage to stderr and exits non-zero.

| Subcommand | Lifetime | What it does |
| --- | --- | --- |
| `publish-episodes` | Ticker, until `SIGINT` / `SIGTERM` | Promotes episodes whose scheduled time has passed |
| `aggregate-content-stats` | One-shot | Rebuilds one UTC day of `content_daily_stats` |
| `aggregate-rankings` | One-shot | Rebuilds the daily and weekly `content_ranking_snapshots` |
| `purge-content-events` | One-shot | Deletes `content_events` rows past their retention window |
| `build-recommend-features` | One-shot | Rebuilds the daily user and item recommend feature snapshots |

Each subcommand reads its own environment variables — the prefixes do not overlap — and owns its own lifecycle, so the ticker and the one-shot jobs stay as different as they were as separate binaries. OpenTelemetry reports `service.name` as `publira-<subcommand>`, still overridable with `OTEL_SERVICE_NAME`.

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

With `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_WEB_HOST_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, and `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` all set, the cache tags of every episode that reaches its publication time are sent to `POST /api/v1/revalidate` on all `web-*` apps. Tags are sent as they are, without a tenant ID restriction. The destinations are private network URLs; neither the public domain nor Traefik is involved. If any URL is unset or malformed, revalidation is disabled and the worker starts after logging the reason.

## aggregate-content-stats

Fully rebuilds `content_daily_stats` for one UTC day across every tenant, from `content_events` and the Phase 0 `purchases` table.

Purchases are counted from `purchases` only. The `content_events` projection of a purchase is not added on top, so nothing is double counted. Each `(tenant_id, stat_date)` is guarded by an advisory lock inside one transaction, which deletes the existing rows before recreating them.

The role needs `BYPASSRLS` (or superuser). For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_STATS_DATE=2026-08-28 go run ./server/cmd/batch aggregate-content-stats
```

Environment variables:

- `PUBLIRA_CONTENT_STATS_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_STATS_DATE`: UTC date as `YYYY-MM-DD`. Defaults to yesterday (UTC).

The structured log records the target date, the number of tenants processed, the rows created, and the elapsed time. If the input holds events or purchases but the aggregation comes out empty, the run deletes nothing, leaves the transaction uncommitted, and exits with an error.

### Query plan

The event range for a day can use `idx_content_events_tenant_type_occurred_at`, and the purchase range `idx_purchases_tenant_purchased_at_episode`. On small data sets PostgreSQL may pick a sequential scan anyway, so add `SET enable_seqscan = off` when checking index eligibility with `EXPLAIN`.

## aggregate-rankings

Rebuilds every tenant's ranking snapshots from the `content_daily_stats` rows `aggregate-content-stats` produces. One run writes four snapshots per tenant — a daily and a weekly leaderboard, each for series and for episodes — so run it after `aggregate-content-stats` for the same day.

The role needs `BYPASSRLS` (or superuser), because one run spans every tenant. For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_RANKING_DATE=2026-08-28 go run ./server/cmd/batch aggregate-rankings
```

Environment variables:

- `PUBLIRA_CONTENT_RANKING_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_CONTENT_RANKING_DATE`: last UTC day of every window, as `YYYY-MM-DD`. Defaults to yesterday (UTC).
- `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT`: how many entities one snapshot carries. Defaults to 50, and must be at least 1.

The structured log records the reference date, item limit, algorithm version, and how many tenants, snapshots, and items the run finished — on failure too, since each tenant commits on its own.

One tenant's four snapshots are written in a single transaction, so a reader never sees this run's daily ranking beside the last run's weekly one. Two runs cannot rank the same tenant at once: the second waits up to 30 seconds for the first and then fails, rather than blocking for the rest of the day with a transaction open.

### Score formula

A snapshot ranks whatever `content_daily_stats` recorded over its window. Each daily row contributes

```text
1 × view_count
+ 2 × unique_viewer_count
+ 20 × purchase_count
+ 8 × favorite_count
+ 3 × max(rating_sum − 3 × rating_count, 0)
```

faded by `0.5 ^ (days before the last day of the window / 3)`, and an entity's score is the sum over its rows.

The weights order the signals by how much a reader committed: paying for an episode says the most, following a series next, and a view least. A distinct viewer counts double a repeat view, so a title read once by many outranks one refreshed by a few. Ratings only ever add — above neutral is a bonus, below it contributes nothing rather than pushing a title down a popularity chart — because a low rating is a quality signal, not an unpopularity one.

Views are whatever `content_daily_stats` holds, which today is soft PV (a successful episode or series detail read). Separating hard PV out is a later change, and it is one that would change the meaning of `view_count`: bump `algorithm_version` with it.

The fade is measured against the end of the window, never against now, so re-running a past day reproduces that day's snapshot exactly. The order is fully determined — score, then purchases, then viewers, then entity id — so two runs over unchanged stats agree on every position, not just on the set of entities.

### Snapshot contract

Each row is one leaderboard, identified by `(tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version)`. A re-run replaces the row with that key in place; a run with a different `algorithm_version` writes alongside it.

| Column | Meaning |
| --- | --- |
| `ranking_key` | `daily` for a single UTC day, `weekly` for the seven days ending on it |
| `period_start`, `period_end` | Inclusive UTC calendar dates. Equal for a daily ranking |
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
- **The snapshot is up to a day stale**, and only as good as its input: a period whose `aggregate-content-stats` run never happened ranks the days that did run.
- **`algorithm_version` may not be the one you compiled against.** Scores are only comparable inside one row, so never compare a score across two snapshots or two versions.

### Query plan and runtime

Each snapshot scans one tenant's `content_daily_stats` for its window and groups by entity. Every index on that table leads with `tenant_id`, so `idx_content_daily_stats_tenant_date`, `idx_content_daily_stats_tenant_entity`, and `idx_content_daily_stats_unique` are all eligible; which one the planner picks depends on how much data the table holds. On small data sets PostgreSQL may pick a sequential scan anyway, so add `SET enable_seqscan = off` when checking index eligibility with `EXPLAIN`.

Every run keeps its four snapshots per tenant, including the empty ones a silent tenant produces: an empty leaderboard is the answer that a run happened and found nothing, which a missing row cannot say. Nothing deletes an old snapshot, so the table grows by four rows per tenant per run.

The work is bounded by the daily rows a tenant produced over the window — at most one row per entity per day, capped by the size of the catalogue — not by raw event volume, so the eight window scans behind one tenant's four snapshots stay small next to the `aggregate-content-stats` run that feeds them. The budget is the daily cron interval, shared with the batches that must run before and after it; judge one run from the elapsed time in its completion log. If a run stops fitting, the fix is upstream of the scan — fewer tenants per invocation, or a materialised per-entity window rollup — because the item limit bounds only what is written, not what is read.

## purge-content-events

Deletes `content_events` rows past their retention window across every tenant, in chunked `DELETE`s.

View events pile up quickly, so raw events are dropped on a deadline (90 days by default) while the durable numbers live on in the `content_daily_stats` rows `aggregate-content-stats` builds. Minimising personal data is part of what this retention window is for.

Rows with `occurred_at < cutoff` are taken oldest first with a `LIMIT`, one chunk per transaction. Because each chunk commits on its own, an interrupted run keeps the work it finished and the next run picks up where it stopped.

The role needs `BYPASSRLS` (or superuser). For local development the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints works as-is.

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

### Query plan

Chunk selection can use `idx_content_events_occurred_at`, a btree on `occurred_at` alone. A tenant-first index does not help a scan that spans every tenant, which is why this one exists for this batch. On small data sets PostgreSQL may pick a sequential scan anyway, so add `SET enable_seqscan = off` when checking index eligibility with `EXPLAIN`.

### When to consider partitioning

The initial scope is a single table plus chunked `DELETE`s. Observing either of the following is the trigger to consider declarative partitioning of `content_events` by `occurred_at`, truncating with `DROP PARTITION` instead:

- One purge no longer fits in the cron interval (judge from the elapsed-time log)
- Table and index size clearly outgrows what `VACUUM` / autovacuum keeps up with (bloat does not come back down after a delete)

## build-recommend-features

Rebuilds `user_recommend_features` and `item_recommend_features` for every tenant from a trailing window of daily engagement data. Online inference v1 reads these snapshots and falls back to rankings or new releases when a subject has no row.

Item features roll up `content_daily_stats`; user features summarise `content_events` for signed-in readers. Both tables are snapshots rather than ledgers: each run replaces one tenant's rows inside a single transaction guarded by an advisory lock, so a subject whose signal aged out of the window loses its row instead of keeping a stale one.

The role needs `BYPASSRLS` (or superuser), because one run spans every tenant. For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_RECOMMEND_FEATURES_DATE=2026-08-28 go run ./server/cmd/batch build-recommend-features
```

Environment variables:

- `PUBLIRA_RECOMMEND_FEATURES_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_RECOMMEND_FEATURES_DATE`: last UTC day of the window, as `YYYY-MM-DD`. Defaults to yesterday (UTC).
- `PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS`: window length in days, ending on that date and including it. Defaults to 28, and must be at least 1.

Run it after `aggregate-content-stats` for the same day: the item snapshot reads the daily stats that batch produces.

The structured log records the reference date, window, feature version, and how many tenants and user and item rows the run finished — on failure too, since each tenant commits on its own. A tenant whose window holds source rows but produces no feature rows fails the run before the transaction commits, so a bad read cannot silently empty a good snapshot.

Two runs cannot rebuild the same tenant at once. The second waits up to 30 seconds for the first to finish that tenant and then fails, rather than blocking for the rest of the day with a transaction open.

### Feature contract

Both tables carry `feature_version`, which this batch stamps with the version the code was built from. Bump it whenever a field's shape or meaning changes, so a reader can tell a freshly built row from one an older build left behind.

`window_start` and `window_end` are inclusive UTC calendar dates; `last_event_at` is an ISO 8601 UTC timestamp.

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
- **Anonymous readers never have a row.** `user_recommend_features` is keyed by `users(tenant_id, id)`, so a `publira_aid` actor has nowhere to be stored. Signed-out traffic is always a fallback case.
- **Rows can disappear between runs.** A reader whose activity aged out of the window loses their row on the next build. Nothing about a previously present row is durable.
- **The snapshot is up to a day stale.** Same-day behaviour is out of scope for v1; a reader's very first sessions are invisible to it.
- **`feature_version` may not be the one you compiled against.** Read the value rather than assuming it, and treat an unexpected version as no signal.
