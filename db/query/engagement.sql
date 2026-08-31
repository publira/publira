-- Engagement / recommend query skeleton (#589).
-- Later issues fill handlers and batches; these queries pin the index-backed
-- shapes so sqlc generates now and EXPLAIN stays checkable.
--
-- Expected plans (empty table may still seq-scan; SET enable_seqscan = off
-- in the integration test to confirm the index is eligible):
--   ListContentEventsByTenantOccurredAt
--     -> idx_content_events_tenant_occurred_at
--   ListContentEventsByTenantTypeOccurredAt
--     -> idx_content_events_tenant_type_occurred_at
--   GetContentDailyStatsByEntity
--     -> idx_content_daily_stats_unique / idx_content_daily_stats_tenant_entity
--   GetContentRankingSnapshot
--     -> idx_content_ranking_snapshots_unique
--   GetLatestContentRankingSnapshot
--     -> idx_content_ranking_snapshots_tenant_key_computed
--   InsertDebouncedEpisodeViewEvent
--     -> idx_content_events_episode_view_debounce
--   InsertProjectedSourceEvent
--     -> idx_content_events_source_unique
--   ListLatestContentRatingsByEntity
--     -> idx_content_events_tenant_series_occurred_at
--   ListRecommendedSeriesIDs / ListRecommendedSeriesIDsReversed
--     -> no index; sorts one tenant's published series (see the note there)

-- name: InsertContentEvent :one
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    anonymous_id,
    series_id,
    episode_id,
    debounce_bucket,
    rating_score,
    source_table,
    source_id,
    payload,
    occurred_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('event_type'),
    sqlc.narg('user_id'),
    sqlc.narg('anonymous_id'),
    sqlc.narg('series_id'),
    sqlc.narg('episode_id'),
    sqlc.narg('debounce_bucket'),
    sqlc.narg('rating_score'),
    sqlc.narg('source_table'),
    sqlc.narg('source_id'),
    sqlc.arg('payload'),
    sqlc.arg('occurred_at')
)
RETURNING *;

-- Fixed 30-minute epoch bucket. Same actor + episode + bucket is a no-op.
-- :one returns no rows on conflict (same as CreateNotification).
-- name: InsertDebouncedEpisodeViewEvent :one
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    anonymous_id,
    series_id,
    episode_id,
    debounce_bucket,
    payload,
    occurred_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    'episode_view',
    sqlc.narg('user_id'),
    sqlc.narg('anonymous_id'),
    sqlc.arg('series_id')::uuid,
    sqlc.arg('episode_id')::uuid,
    sqlc.arg('debounce_bucket')::bigint,
    sqlc.arg('payload'),
    sqlc.arg('occurred_at')
)
ON CONFLICT (tenant_id, event_type, episode_id, actor_key, debounce_bucket)
WHERE event_type = 'episode_view'
DO NOTHING
RETURNING *;

-- name: InsertDebouncedSeriesViewEvent :one
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    anonymous_id,
    series_id,
    debounce_bucket,
    payload,
    occurred_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    'series_view',
    sqlc.narg('user_id'),
    sqlc.narg('anonymous_id'),
    sqlc.arg('series_id')::uuid,
    sqlc.arg('debounce_bucket')::bigint,
    sqlc.arg('payload'),
    sqlc.arg('occurred_at')
)
ON CONFLICT (tenant_id, event_type, series_id, actor_key, debounce_bucket)
WHERE event_type = 'series_view'
DO NOTHING
RETURNING *;

-- Idempotent projection from a SoT row (purchases.id, access_tickets.id).
-- name: InsertProjectedSourceEvent :one
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    series_id,
    episode_id,
    source_table,
    source_id,
    payload,
    occurred_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('event_type'),
    sqlc.arg('user_id')::uuid,
    sqlc.arg('series_id')::uuid,
    sqlc.arg('episode_id')::uuid,
    sqlc.arg('source_table')::text,
    sqlc.arg('source_id')::uuid,
    sqlc.arg('payload'),
    sqlc.arg('occurred_at')
)
ON CONFLICT (tenant_id, source_table, source_id)
WHERE source_id IS NOT NULL
DO NOTHING
RETURNING *;

-- Projects the Stripe-confirmed purchase without trusting webhook metadata for
-- the actor or content target. purchases stays the source of truth: its user
-- is copied directly and the episode resolves its owning series. A retry is a
-- no-op after the source unique index has accepted the first event.
--
-- The Phase 0 daily purchase aggregate reads purchases directly. Do not mix
-- this projection into that aggregate until its source contract moves to
-- content_events, or purchases will be counted twice.
-- name: ProjectPurchaseContentEvent :one
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    series_id,
    episode_id,
    source_table,
    source_id,
    payload,
    occurred_at
)
SELECT
    sqlc.arg('id'),
    p.tenant_id,
    'purchase',
    p.user_id,
    e.series_id,
    p.episode_id,
    'purchases',
    p.id,
    '{}'::jsonb,
    p.purchased_at
FROM purchases p
JOIN episodes e
    ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.stripe_checkout_session_id = sqlc.arg('stripe_checkout_session_id')::text
ON CONFLICT (tenant_id, source_table, source_id)
WHERE source_id IS NOT NULL
DO NOTHING
RETURNING *;

-- Ratings are append-only, like every other content_events row: a member who
-- changes their score inserts another event instead of updating the previous
-- one, so the history stays reconstructable and nothing has to be deleted.
-- Which score "counts" is therefore a read-side decision, not a write-side one
-- (see ListLatestContentRatingsByEntity). There is deliberately no debounce
-- bucket here: a rating is an explicit act, not a page load.
--
-- episode_id NULL rates the series itself; set, it rates that episode, and
-- series_id must still be the episode's own series. Both are resolved by the
-- server from the catalog row, never taken from client input.
-- name: InsertRatingEvent :one
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    series_id,
    episode_id,
    rating_score,
    occurred_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    'rating',
    sqlc.arg('user_id')::uuid,
    sqlc.arg('series_id')::uuid,
    sqlc.narg('episode_id'),
    sqlc.arg('rating_score')::smallint,
    sqlc.arg('occurred_at')
)
RETURNING *;

-- The latest rating each actor currently stands by for one entity: the stock
-- view of an append-only log. `content_daily_stats.rating_count` /
-- `rating_sum` (#593) are the *flow* of a single day and cannot answer this,
-- because a member who rated 1 on Monday and 5 on Tuesday contributes to both
-- days. A stock average has to come from this DISTINCT ON, over the full
-- retained history, until a materialised current-rating table exists.
--
-- The tie-break runs past occurred_at because two events from one actor can
-- share a timestamp; id is UUIDv7, so the later insert wins.
-- name: ListLatestContentRatingsByEntity :many
SELECT DISTINCT ON (actor_key) actor_key,
    rating_score,
    occurred_at
FROM content_events
WHERE tenant_id = sqlc.arg('tenant_id')
    AND event_type = 'rating'
    AND series_id = sqlc.arg('series_id')::uuid
    AND episode_id IS NOT DISTINCT FROM sqlc.narg('episode_id')::uuid
ORDER BY actor_key, occurred_at DESC, id DESC;

-- name: GetContentEventByID :one
SELECT *
FROM content_events
WHERE id = sqlc.arg('id');

-- Representative tenant timeline. EXPLAIN: idx_content_events_tenant_occurred_at.
-- name: ListContentEventsByTenantOccurredAt :many
SELECT *
FROM content_events
WHERE tenant_id = sqlc.arg('tenant_id')
ORDER BY occurred_at DESC
LIMIT sqlc.arg('limit');

-- Representative type-filtered timeline. EXPLAIN: idx_content_events_tenant_type_occurred_at.
-- name: ListContentEventsByTenantTypeOccurredAt :many
SELECT *
FROM content_events
WHERE tenant_id = sqlc.arg('tenant_id')
    AND event_type = sqlc.arg('event_type')
ORDER BY occurred_at DESC
LIMIT sqlc.arg('limit');

-- Daily stats are full-day replacements (#593). Upsert keeps a single row per
-- (tenant, date, entity). rating_count / rating_sum are that day's flow — the
-- rating events that occurred on stat_date — and not a stock average: a member
-- who re-rates is counted on both days, and a member who never re-rates is
-- counted on neither day after the first. Summing rating_sum / rating_count
-- across a date range therefore averages ratings *given* in that range, not
-- the ratings an item currently holds (ListLatestContentRatingsByEntity).
-- name: UpsertContentDailyStats :one
INSERT INTO content_daily_stats (
    id,
    tenant_id,
    stat_date,
    entity_type,
    entity_id,
    view_count,
    unique_viewer_count,
    purchase_count,
    rating_count,
    rating_sum,
    favorite_count
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('stat_date'),
    sqlc.arg('entity_type'),
    sqlc.arg('entity_id'),
    sqlc.arg('view_count'),
    sqlc.arg('unique_viewer_count'),
    sqlc.arg('purchase_count'),
    sqlc.arg('rating_count'),
    sqlc.arg('rating_sum'),
    sqlc.arg('favorite_count')
)
ON CONFLICT (tenant_id, stat_date, entity_type, entity_id) DO UPDATE
SET view_count = EXCLUDED.view_count,
    unique_viewer_count = EXCLUDED.unique_viewer_count,
    purchase_count = EXCLUDED.purchase_count,
    rating_count = EXCLUDED.rating_count,
    rating_sum = EXCLUDED.rating_sum,
    favorite_count = EXCLUDED.favorite_count,
    updated_at = NOW()
RETURNING *;

-- name: GetContentDailyStatsByEntity :one
SELECT *
FROM content_daily_stats
WHERE tenant_id = sqlc.arg('tenant_id')
    AND stat_date = sqlc.arg('stat_date')
    AND entity_type = sqlc.arg('entity_type')
    AND entity_id = sqlc.arg('entity_id');

-- name: ListContentDailyStatsByTenantDate :many
SELECT *
FROM content_daily_stats
WHERE tenant_id = sqlc.arg('tenant_id')
    AND stat_date = sqlc.arg('stat_date')
ORDER BY entity_type, entity_id;

-- name: UpsertUserRecommendFeatures :one
INSERT INTO user_recommend_features (
    tenant_id,
    user_id,
    features,
    feature_version,
    computed_at
) VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('features'),
    sqlc.arg('feature_version'),
    sqlc.arg('computed_at')
)
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET features = EXCLUDED.features,
    feature_version = EXCLUDED.feature_version,
    computed_at = EXCLUDED.computed_at
RETURNING *;

-- name: GetUserRecommendFeatures :one
SELECT *
FROM user_recommend_features
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id');

-- name: UpsertItemRecommendFeatures :one
INSERT INTO item_recommend_features (
    tenant_id,
    entity_type,
    entity_id,
    features,
    feature_version,
    computed_at
) VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('entity_type'),
    sqlc.arg('entity_id'),
    sqlc.arg('features'),
    sqlc.arg('feature_version'),
    sqlc.arg('computed_at')
)
ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
SET features = EXCLUDED.features,
    feature_version = EXCLUDED.feature_version,
    computed_at = EXCLUDED.computed_at
RETURNING *;

-- name: GetItemRecommendFeatures :one
SELECT *
FROM item_recommend_features
WHERE tenant_id = sqlc.arg('tenant_id')
    AND entity_type = sqlc.arg('entity_type')
    AND entity_id = sqlc.arg('entity_id');

-- name: UpsertContentRankingSnapshot :one
INSERT INTO content_ranking_snapshots (
    id,
    tenant_id,
    ranking_key,
    period_start,
    period_end,
    entity_type,
    items,
    algorithm_version,
    computed_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('ranking_key'),
    sqlc.arg('period_start'),
    sqlc.arg('period_end'),
    sqlc.arg('entity_type'),
    sqlc.arg('items'),
    sqlc.arg('algorithm_version'),
    sqlc.arg('computed_at')
)
ON CONFLICT (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version) DO UPDATE
SET items = EXCLUDED.items,
    computed_at = EXCLUDED.computed_at
RETURNING *;

-- name: GetContentRankingSnapshot :one
SELECT *
FROM content_ranking_snapshots
WHERE tenant_id = sqlc.arg('tenant_id')
    AND ranking_key = sqlc.arg('ranking_key')
    AND period_start = sqlc.arg('period_start')
    AND period_end = sqlc.arg('period_end')
    AND entity_type = sqlc.arg('entity_type')
    AND algorithm_version = sqlc.arg('algorithm_version');

-- The newest snapshot for one ranking key and entity type, whichever period
-- and algorithm version produced it. A reader on a request path cannot know
-- which day the last batch run covered, so it asks for the most recently
-- computed row instead of naming period bounds. A bumped algorithm_version
-- files its snapshots beside the old ones rather than replacing them, and wins
-- here because it was computed later.
-- name: GetLatestContentRankingSnapshot :one
SELECT *
FROM content_ranking_snapshots
WHERE tenant_id = sqlc.arg('tenant_id')
    AND ranking_key = sqlc.arg('ranking_key')
    AND entity_type = sqlc.arg('entity_type')
ORDER BY computed_at DESC
LIMIT 1;

-- The keyset scan behind the storefront recommendation list. It takes one
-- ranking snapshot's items as they are stored and puts the ranked series first,
-- then every other published series newest first.
--
-- The sort key is (sort_rank, published_at, id). A series the snapshot does not
-- name borrows int4's maximum and sorts last; every rank a snapshot can hold is
-- below it. Ties are impossible: a rank is unique within a snapshot, and the
-- unranked share one sort_rank that id breaks.
--
-- This is the one list query here that no index can serve. Its first sort key
-- comes from the snapshot's JSONB rather than from a column of series, so the
-- scan reads the tenant's published series and sorts them. That is bounded by
-- one tenant's catalogue, and ranking_items is one snapshot (50 items by
-- default), folded per entity_id so the LEFT JOIN cannot multiply rows.
-- name: ListRecommendedSeriesIDs :many
WITH ranked AS (
    SELECT (item->>'entity_id')::uuid AS entity_id,
        min((item->>'rank')::int) AS rank
    FROM jsonb_array_elements(sqlc.arg('ranking_items')::jsonb) AS item
    GROUP BY (item->>'entity_id')::uuid
),
candidate AS (
    SELECT s.id,
        s.published_at,
        COALESCE(r.rank, 2147483647) AS sort_rank
    FROM series s
        LEFT JOIN ranked r ON r.entity_id = s.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
)
SELECT id
FROM candidate
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR sort_rank > sqlc.narg('cursor_rank')::int
        OR (
            sort_rank = sqlc.narg('cursor_rank')::int
            AND (
                (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND (published_at, id) <= (
                        sqlc.narg('cursor_published_at')::timestamptz,
                        sqlc.narg('cursor_id')::uuid
                    )
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND (published_at, id) < (
                        sqlc.narg('cursor_published_at')::timestamptz,
                        sqlc.narg('cursor_id')::uuid
                    )
                )
            )
        )
    )
ORDER BY sort_rank ASC,
    published_at DESC,
    id DESC
LIMIT sqlc.arg('limit');

-- ListRecommendedSeriesIDs walked the other way. It exists only to build a
-- previous page; the order it describes is the same one.
-- name: ListRecommendedSeriesIDsReversed :many
WITH ranked AS (
    SELECT (item->>'entity_id')::uuid AS entity_id,
        min((item->>'rank')::int) AS rank
    FROM jsonb_array_elements(sqlc.arg('ranking_items')::jsonb) AS item
    GROUP BY (item->>'entity_id')::uuid
),
candidate AS (
    SELECT s.id,
        s.published_at,
        COALESCE(r.rank, 2147483647) AS sort_rank
    FROM series s
        LEFT JOIN ranked r ON r.entity_id = s.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
)
SELECT id
FROM candidate
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR sort_rank < sqlc.narg('cursor_rank')::int
        OR (
            sort_rank = sqlc.narg('cursor_rank')::int
            AND (
                (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND (published_at, id) >= (
                        sqlc.narg('cursor_published_at')::timestamptz,
                        sqlc.narg('cursor_id')::uuid
                    )
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND (published_at, id) > (
                        sqlc.narg('cursor_published_at')::timestamptz,
                        sqlc.narg('cursor_id')::uuid
                    )
                )
            )
        )
    )
ORDER BY sort_rank DESC,
    published_at ASC,
    id ASC
LIMIT sqlc.arg('limit');
