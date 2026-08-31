# batch

Every batch job ships in this single binary. The first argument names the job:

```bash
task server:build
./server/bin/batch aggregate-content-stats
```

Without an argument, or with a name that is not one of the four below, the binary prints its usage to stderr and exits non-zero.

| Subcommand | Lifetime | What it does |
| --- | --- | --- |
| `publish-episodes` | Ticker, until `SIGINT` / `SIGTERM` | Promotes episodes whose scheduled time has passed |
| `aggregate-content-stats` | One-shot | Rebuilds one UTC day of `content_daily_stats` |
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
