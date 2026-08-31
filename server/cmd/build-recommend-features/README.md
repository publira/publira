# build-recommend-features

One-shot batch that rebuilds `user_recommend_features` and `item_recommend_features` for every tenant from a trailing window of daily engagement data. Online inference v1 reads these snapshots and falls back to rankings or new releases when a subject has no row.

Item features roll up `content_daily_stats`; user features summarise `content_events` for signed-in readers. Both tables are snapshots rather than ledgers: each run replaces one tenant's rows inside a single transaction guarded by an advisory lock, so a subject whose signal aged out of the window loses its row instead of keeping a stale one.

## Running

The role needs `BYPASSRLS` (or superuser), because one run spans every tenant. For local development use the `PUBLIRA_CONTENT_STATS_DB_URL` that `task --silent dev-env:env` prints.

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_RECOMMEND_FEATURES_DATE=2026-08-28 go run ./server/cmd/build-recommend-features
```

Environment variables:

- `PUBLIRA_RECOMMEND_FEATURES_DB_URL`: dedicated BYPASSRLS connection URL. Falls back to `PUBLIRA_CONTENT_STATS_DB_URL`, then `PUBLIRA_WORKER_DB_URL`, then `PUBLIRA_DB_URL`.
- `PUBLIRA_RECOMMEND_FEATURES_DATE`: last UTC day of the window, as `YYYY-MM-DD`. Defaults to yesterday (UTC).
- `PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS`: window length in days, ending on that date and including it. Defaults to 28, and must be at least 1.

Run it after `aggregate-content-stats` for the same day: the item snapshot reads the daily stats that batch produces.

The structured log records the reference date, window, feature version, and how many tenants and user and item rows the run finished — on failure too, since each tenant commits on its own. A tenant whose window holds source rows but produces no feature rows fails the run before the transaction commits, so a bad read cannot silently empty a good snapshot.

Two runs cannot rebuild the same tenant at once. The second waits up to 30 seconds for the first to finish that tenant and then fails, rather than blocking for the rest of the day with a transaction open.

## Feature contract

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

### What a reader must tolerate

Neither table is complete, and an inference path that assumes otherwise breaks on ordinary traffic:

- **A missing row is the normal case, not an error.** A tenant that has never run the batch, a reader in their first session, and a series published after the window closed all have no row. Treat absence as "no signal" and fall back to the ranking snapshot or new releases.
- **Anonymous readers never have a row.** `user_recommend_features` is keyed by `users(tenant_id, id)`, so a `publira_aid` actor has nowhere to be stored. Signed-out traffic is always a fallback case.
- **Rows can disappear between runs.** A reader whose activity aged out of the window loses their row on the next build. Nothing about a previously present row is durable.
- **The snapshot is up to a day stale.** Same-day behaviour is out of scope for v1; a reader's very first sessions are invisible to it.
- **`feature_version` may not be the one you compiled against.** Read the value rather than assuming it, and treat an unexpected version as no signal.
