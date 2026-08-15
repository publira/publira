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
--   InsertDebouncedEpisodeViewEvent
--     -> idx_content_events_episode_view_debounce
--   InsertProjectedSourceEvent
--     -> idx_content_events_source_unique

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
-- (tenant, date, entity). rating_* are that day's flow, not a stock average.
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
