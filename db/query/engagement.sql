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
--   ListEpisodeReadThroughDesc / ListEpisodeReadThroughAsc
--     -> idx_content_daily_stats_tenant_date for the window, then a sort on the
--        aggregate it groups (see the note there)

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

-- Projects one member's first completed read as the analytics event for that
-- read. episode_reads stays the source of truth for the business state: its
-- user, episode, and first read time are copied, and the owning series is
-- resolved from the catalog rather than taken from the caller.
--
-- The pair (source_table, source_id) is what makes this replayable. A repeated
-- notification returns the same episode_reads row, so the projection lands on
-- the same source key and the unique index turns the second attempt into a
-- no-op. Nothing here depends on knowing whether the read row was new.
-- name: ProjectEpisodeCompleteEvent :one
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
    r.tenant_id,
    'episode_complete',
    r.user_id,
    e.series_id,
    r.episode_id,
    'episode_reads',
    r.id,
    '{}'::jsonb,
    r.read_at
FROM episode_reads r
JOIN episodes e
    ON e.tenant_id = r.tenant_id
    AND e.id = r.episode_id
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.user_id = sqlc.arg('user_id')
    AND r.episode_id = sqlc.arg('episode_id')
ON CONFLICT (tenant_id, source_table, source_id)
WHERE source_id IS NOT NULL
DO NOTHING
RETURNING *;

-- Reconciles episode_reads rows whose projection never landed, across every
-- tenant. The request path writes the event outside the transaction that
-- stored the read and swallows its failure, so a completion can outlive its
-- event; this is how that gap closes.
--
-- The anti-join and the unique index answer the same question at different
-- times, and both are needed: the anti-join keeps the statement from proposing
-- rows that already exist, and ON CONFLICT keeps a concurrent request-path
-- write from turning this run into a duplicate key error. Ordering by read_at
-- makes a run resumable — every batch takes the oldest unprojected reads — so
-- repeated runs converge instead of revisiting the same window.
--
-- Both counts come back because they answer different questions and can differ.
-- candidate_count is how many unprojected reads this batch claimed, and is what
-- tells the caller whether the backlog is exhausted; inserted_count is how many
-- events were actually written. A request-path write that lands between this
-- statement's select and its insert makes the second smaller than the first, so
-- a caller that looped on inserted_count would stop with reads still pending.
--
-- id is uuidv7() rather than a value passed in because the statement inserts a
-- whole batch; content_events ids are UUIDv7 so that events sharing an
-- occurred_at still order by when they were recorded.
-- name: ProjectPendingEpisodeCompleteEvents :one
WITH candidates AS (
    SELECT r.id,
        r.tenant_id,
        r.user_id,
        r.episode_id,
        r.read_at,
        e.series_id
    FROM episode_reads r
    JOIN episodes e
        ON e.tenant_id = r.tenant_id
        AND e.id = r.episode_id
    WHERE NOT EXISTS (
            SELECT 1
            FROM content_events ce
            WHERE ce.tenant_id = r.tenant_id
                AND ce.source_table = 'episode_reads'
                AND ce.source_id = r.id
        )
    ORDER BY r.read_at, r.id
    LIMIT sqlc.arg('limit')
), inserted AS (
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
        uuidv7(),
        c.tenant_id,
        'episode_complete',
        c.user_id,
        c.series_id,
        c.episode_id,
        'episode_reads',
        c.id,
        '{}'::jsonb,
        c.read_at
    FROM candidates c
    ON CONFLICT (tenant_id, source_table, source_id)
    WHERE source_id IS NOT NULL
    DO NOTHING
    RETURNING 1
)
SELECT (SELECT count(*) FROM candidates)::bigint AS candidate_count,
    (SELECT count(*) FROM inserted)::bigint AS inserted_count;

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
    member_view_count,
    purchase_count,
    complete_count,
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
    sqlc.arg('member_view_count'),
    sqlc.arg('purchase_count'),
    sqlc.arg('complete_count'),
    sqlc.arg('rating_count'),
    sqlc.arg('rating_sum'),
    sqlc.arg('favorite_count')
)
ON CONFLICT (tenant_id, stat_date, entity_type, entity_id) DO UPDATE
SET view_count = EXCLUDED.view_count,
    unique_viewer_count = EXCLUDED.unique_viewer_count,
    member_view_count = EXCLUDED.member_view_count,
    purchase_count = EXCLUDED.purchase_count,
    complete_count = EXCLUDED.complete_count,
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

-- The read-through report the console shows, over a closed range of UTC stat
-- dates. Both halves of the rate come from the same cohort: complete_count is
-- the members who finished the episode in the range, member_view_count the
-- views those same signed-in members opened it with. view_count is not usable
-- here — it counts anonymous readers, who cannot produce a completion at all.
--
-- No index can serve this scan: the sort key is an aggregate of the rows the
-- query itself groups, the way ListRecommendedSeriesIDs sorts by a rank its own
-- JSON supplies. It stays bounded by one tenant's episode rows inside the
-- report window, which idx_content_daily_stats_tenant_date narrows first.
--
-- (complete_count, entity_id) is unique because entity_id alone is, so the
-- keyset scan can neither skip nor repeat episodes that tie on completions.
-- name: ListEpisodeReadThroughDesc :many
WITH totals AS (
    SELECT s.entity_id,
        sum(s.complete_count)::bigint AS complete_count,
        sum(s.member_view_count)::bigint AS member_view_count
    FROM content_daily_stats s
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.entity_type = 'episode'
        AND s.stat_date >= sqlc.arg('period_start')
        AND s.stat_date <= sqlc.arg('period_end')
    GROUP BY s.entity_id
    HAVING sum(s.complete_count) > 0 OR sum(s.member_view_count) > 0
)
SELECT t.entity_id AS episode_id,
    t.complete_count,
    t.member_view_count,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    sr.public_id AS series_public_id,
    sr.title AS series_title
FROM totals t
    JOIN episodes e ON e.tenant_id = sqlc.arg('tenant_id') AND e.id = t.entity_id
    JOIN series sr ON sr.tenant_id = e.tenant_id AND sr.id = e.series_id
WHERE (
        sqlc.narg('cursor_entity_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.entity_id) <= (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_entity_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.entity_id) < (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_entity_id')::uuid
            )
        )
    )
ORDER BY t.complete_count DESC, t.entity_id DESC
LIMIT sqlc.arg('limit');

-- ListEpisodeReadThroughDesc walked the other way, to build a previous page.
-- The order it describes is the same one.
-- name: ListEpisodeReadThroughAsc :many
WITH totals AS (
    SELECT s.entity_id,
        sum(s.complete_count)::bigint AS complete_count,
        sum(s.member_view_count)::bigint AS member_view_count
    FROM content_daily_stats s
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.entity_type = 'episode'
        AND s.stat_date >= sqlc.arg('period_start')
        AND s.stat_date <= sqlc.arg('period_end')
    GROUP BY s.entity_id
    HAVING sum(s.complete_count) > 0 OR sum(s.member_view_count) > 0
)
SELECT t.entity_id AS episode_id,
    t.complete_count,
    t.member_view_count,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    sr.public_id AS series_public_id,
    sr.title AS series_title
FROM totals t
    JOIN episodes e ON e.tenant_id = sqlc.arg('tenant_id') AND e.id = t.entity_id
    JOIN series sr ON sr.tenant_id = e.tenant_id AND sr.id = e.series_id
WHERE (
        sqlc.narg('cursor_entity_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.entity_id) >= (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_entity_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.entity_id) > (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_entity_id')::uuid
            )
        )
    )
ORDER BY t.complete_count ASC, t.entity_id ASC
LIMIT sqlc.arg('limit');

-- The tenant-wide numerator and denominator for the same window. This is the
-- headline metric rather than a page count, so it does not fall under the "no
-- total for a cursor list" rule: it stays the same value on every page, and a
-- rate assembled from one page's rows would describe that page instead of the
-- period.
-- name: GetEpisodeReadThroughTotals :one
SELECT COALESCE(sum(complete_count), 0)::bigint AS complete_count,
    COALESCE(sum(member_view_count), 0)::bigint AS member_view_count
FROM content_daily_stats
WHERE tenant_id = sqlc.arg('tenant_id')
    AND entity_type = 'episode'
    AND stat_date >= sqlc.arg('period_start')
    AND stat_date <= sqlc.arg('period_end');

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
-- sort_rank comes back with each row because the cursor is built from it. A
-- caller that recomputed the rank from the same JSON would have to fold
-- duplicates and missing ranks exactly the way min() and COALESCE do here, and
-- a token built on a value this query never sorted by points at the wrong page.
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
        COALESCE(r.rank, 2147483647)::int AS sort_rank
    FROM series s
        LEFT JOIN ranked r ON r.entity_id = s.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
)
SELECT id, sort_rank
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
        COALESCE(r.rank, 2147483647)::int AS sort_rank
    FROM series s
        LEFT JOIN ranked r ON r.entity_id = s.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
)
SELECT id, sort_rank
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
