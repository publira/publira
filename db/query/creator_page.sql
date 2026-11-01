-- The Author pages: what a reader linked to a creator reads of that creator.
-- Every query starts from the reader's own row of creator_accounts, the link
-- the creator grant and the comment badge read too, so a page answers about
-- no creator the reader is not linked to whatever ID the request names.

-- name: ListMyCreators :many
-- The creators the account is linked to, oldest link first. The series count
-- is the one PublishedCreator carries, on the calling surface.
SELECT c.id,
    c.public_id,
    c.name,
    c.icon_image_id,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
            AND EXISTS (
                SELECT 1
                FROM series_surfaces ss
                WHERE ss.series_id = s.id
                    AND ss.surface = sqlc.arg('surface')::text
            )
    ) AS published_series_count
FROM creator_accounts ca
    JOIN creators c ON c.tenant_id = ca.tenant_id
        AND c.id = ca.creator_id
WHERE ca.tenant_id = sqlc.arg('tenant_id')
    AND ca.user_id = sqlc.arg('user_id')
ORDER BY ca.created_at ASC,
    ca.creator_id ASC;

-- name: GetMyCreatorFollowerCount :one
-- The readers following one of the account's creators now. No row means the
-- account is not linked to the creator; a linked creator nobody has followed
-- has no tally row and counts 0.
SELECT COALESCE(fc.count, 0)::bigint AS follower_count
FROM creator_accounts ca
    LEFT JOIN creator_follower_counts fc ON fc.tenant_id = ca.tenant_id
        AND fc.creator_id = ca.creator_id
WHERE ca.tenant_id = sqlc.arg('tenant_id')
    AND ca.user_id = sqlc.arg('user_id')
    AND ca.creator_id = sqlc.arg('creator_id');

-- name: GetMyCreatorEpisodeStatsTotals :one
-- What every episode crediting the creator that the surface shows now was read
-- over the window, as ListMyCreatorEpisodeStatsDesc counts each. The episodes
-- are those episode_creators credits, the rule the creator grant follows,
-- rather than the series credit.
WITH credited AS (
    SELECT DISTINCT ec.episode_id
    FROM creator_accounts ca
        JOIN episode_creators ec ON ec.tenant_id = ca.tenant_id
            AND ec.creator_id = ca.creator_id
        JOIN published_episode_surfaces pes ON pes.tenant_id = ec.tenant_id
            AND pes.episode_id = ec.episode_id
            AND pes.surface = sqlc.arg('surface')::text
    WHERE ca.tenant_id = sqlc.arg('tenant_id')
        AND ca.user_id = sqlc.arg('user_id')
        AND ca.creator_id = sqlc.arg('creator_id')
)
SELECT COALESCE(sum(s.complete_count), 0)::bigint AS complete_count,
    COALESCE(sum(s.member_view_count), 0)::bigint AS member_view_count
FROM credited cr
    JOIN content_daily_stats s ON s.tenant_id = sqlc.arg('tenant_id')
        AND s.entity_type = 'episode'
        AND s.entity_id = cr.episode_id
        AND s.stat_date >= sqlc.arg('period_start')
        AND s.stat_date <= sqlc.arg('period_end');

-- name: ListMyCreatorEpisodeStatsDesc :many
-- Each episode crediting the creator that the surface shows now, with what it
-- was read over the window, zeros included, most completions first. The order
-- is the console's read-through report's.
WITH credited AS (
    SELECT DISTINCT ec.episode_id
    FROM creator_accounts ca
        JOIN episode_creators ec ON ec.tenant_id = ca.tenant_id
            AND ec.creator_id = ca.creator_id
        JOIN published_episode_surfaces pes ON pes.tenant_id = ec.tenant_id
            AND pes.episode_id = ec.episode_id
            AND pes.surface = sqlc.arg('surface')::text
    WHERE ca.tenant_id = sqlc.arg('tenant_id')
        AND ca.user_id = sqlc.arg('user_id')
        AND ca.creator_id = sqlc.arg('creator_id')
),
totals AS (
    SELECT cr.episode_id,
        COALESCE(sum(s.complete_count), 0)::bigint AS complete_count,
        COALESCE(sum(s.member_view_count), 0)::bigint AS member_view_count
    FROM credited cr
        LEFT JOIN content_daily_stats s ON s.tenant_id = sqlc.arg('tenant_id')
            AND s.entity_type = 'episode'
            AND s.entity_id = cr.episode_id
            AND s.stat_date >= sqlc.arg('period_start')
            AND s.stat_date <= sqlc.arg('period_end')
    GROUP BY cr.episode_id
)
SELECT t.episode_id,
    t.complete_count,
    t.member_view_count,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    sr.public_id AS series_public_id,
    srtr.title AS series_title
FROM totals t
    JOIN episodes e ON e.tenant_id = sqlc.arg('tenant_id') AND e.id = t.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et
    JOIN series sr ON sr.tenant_id = e.tenant_id AND sr.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(sr.id, sqlc.arg('locale')::text) srtr
WHERE (
        sqlc.narg('cursor_episode_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.episode_id) <= (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.episode_id) < (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
    )
ORDER BY t.complete_count DESC, t.episode_id DESC
LIMIT sqlc.arg('limit');

-- ListMyCreatorEpisodeStatsDesc walked the other way, to build a previous
-- page. The order it describes is the same one.
-- name: ListMyCreatorEpisodeStatsAsc :many
WITH credited AS (
    SELECT DISTINCT ec.episode_id
    FROM creator_accounts ca
        JOIN episode_creators ec ON ec.tenant_id = ca.tenant_id
            AND ec.creator_id = ca.creator_id
        JOIN published_episode_surfaces pes ON pes.tenant_id = ec.tenant_id
            AND pes.episode_id = ec.episode_id
            AND pes.surface = sqlc.arg('surface')::text
    WHERE ca.tenant_id = sqlc.arg('tenant_id')
        AND ca.user_id = sqlc.arg('user_id')
        AND ca.creator_id = sqlc.arg('creator_id')
),
totals AS (
    SELECT cr.episode_id,
        COALESCE(sum(s.complete_count), 0)::bigint AS complete_count,
        COALESCE(sum(s.member_view_count), 0)::bigint AS member_view_count
    FROM credited cr
        LEFT JOIN content_daily_stats s ON s.tenant_id = sqlc.arg('tenant_id')
            AND s.entity_type = 'episode'
            AND s.entity_id = cr.episode_id
            AND s.stat_date >= sqlc.arg('period_start')
            AND s.stat_date <= sqlc.arg('period_end')
    GROUP BY cr.episode_id
)
SELECT t.episode_id,
    t.complete_count,
    t.member_view_count,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    sr.public_id AS series_public_id,
    srtr.title AS series_title
FROM totals t
    JOIN episodes e ON e.tenant_id = sqlc.arg('tenant_id') AND e.id = t.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et
    JOIN series sr ON sr.tenant_id = e.tenant_id AND sr.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(sr.id, sqlc.arg('locale')::text) srtr
WHERE (
        sqlc.narg('cursor_episode_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.episode_id) >= (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (t.complete_count, t.episode_id) > (
                sqlc.narg('cursor_complete_count')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
    )
ORDER BY t.complete_count ASC, t.episode_id ASC
LIMIT sqlc.arg('limit');

-- name: ListMyCreatorEpisodeSales :many
-- What the named episodes sold in the window, counted as ListEpisodeRevenueDesc
-- counts an episode: each purchase that paid for it, at the part of its price
-- the episode accounts for, less that part of what went back. An episode that
-- sold nothing has no row.
SELECT
    pp.episode_id,
    count(*)::bigint AS purchase_count,
    sum(pp.price)::bigint AS gross_amount,
    sum(episode_part_of_purchase_amount(
        purchase_returned_amount(p.price_at_purchase, p.refunded_amount, p.dispute_lost_at),
        pp.price,
        p.price_at_purchase
    ))::bigint AS refunded_amount
FROM purchases p
JOIN purchase_episode_parts pp ON pp.tenant_id = p.tenant_id
    AND pp.purchase_id = p.id
    AND pp.episode_id = ANY(sqlc.arg('episode_ids')::uuid [])
    AND pp.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    AND pp.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND NOT p.is_test
    AND p.coin_pack_id IS NULL
    AND p.currency = sqlc.arg('currency')::text
    AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
GROUP BY pp.episode_id;

-- name: ListMyCreatorStatementsDesc :many
-- Every closed month, newest first, with the sum of the creator's own lines
-- of it. The lines are read through the account's link to the creator, so no
-- other creator's line is ever summed; a month that credited the creator
-- nothing sums to zero. The period is unique per tenant, so it alone is the
-- keyset.
SELECT rs.period,
    rs.time_zone,
    rs.closed_at,
    rs.currency,
    mine.sale_count,
    mine.gross_amount,
    mine.refunded_amount,
    mine.payout_amount
FROM royalty_statements rs
    CROSS JOIN LATERAL (
        SELECT COALESCE(sum(l.sale_count), 0)::bigint AS sale_count,
            COALESCE(sum(l.gross_amount), 0)::bigint AS gross_amount,
            COALESCE(sum(l.refunded_amount), 0)::bigint AS refunded_amount,
            COALESCE(sum(l.payout_amount), 0)::bigint AS payout_amount
        FROM royalty_statement_lines l
            JOIN creator_accounts ca ON ca.tenant_id = l.tenant_id
                AND ca.creator_id = l.creator_id
        WHERE l.tenant_id = rs.tenant_id
            AND l.statement_id = rs.id
            AND ca.user_id = sqlc.arg('user_id')
            AND ca.creator_id = sqlc.arg('creator_id')
    ) mine
WHERE rs.tenant_id = sqlc.arg('tenant_id')
    AND (
        NOT sqlc.arg('has_cursor')::boolean
        OR rs.period < sqlc.arg('cursor_period')::date
    )
ORDER BY rs.period DESC
LIMIT sqlc.arg('row_limit');

-- name: ListMyCreatorStatementsAsc :many
-- ListMyCreatorStatementsDesc walked backwards, for a previous-page token.
SELECT rs.period,
    rs.time_zone,
    rs.closed_at,
    rs.currency,
    mine.sale_count,
    mine.gross_amount,
    mine.refunded_amount,
    mine.payout_amount
FROM royalty_statements rs
    CROSS JOIN LATERAL (
        SELECT COALESCE(sum(l.sale_count), 0)::bigint AS sale_count,
            COALESCE(sum(l.gross_amount), 0)::bigint AS gross_amount,
            COALESCE(sum(l.refunded_amount), 0)::bigint AS refunded_amount,
            COALESCE(sum(l.payout_amount), 0)::bigint AS payout_amount
        FROM royalty_statement_lines l
            JOIN creator_accounts ca ON ca.tenant_id = l.tenant_id
                AND ca.creator_id = l.creator_id
        WHERE l.tenant_id = rs.tenant_id
            AND l.statement_id = rs.id
            AND ca.user_id = sqlc.arg('user_id')
            AND ca.creator_id = sqlc.arg('creator_id')
    ) mine
WHERE rs.tenant_id = sqlc.arg('tenant_id')
    AND rs.period > sqlc.arg('cursor_period')::date
ORDER BY rs.period ASC
LIMIT sqlc.arg('row_limit');

-- name: GetMyCreatorStatement :one
-- One closed month with the sum of the creator's own lines of it, as
-- ListMyCreatorStatementsDesc sums them. No row means the month is not closed.
SELECT rs.id,
    rs.period,
    rs.time_zone,
    rs.closed_at,
    rs.currency,
    mine.sale_count,
    mine.gross_amount,
    mine.refunded_amount,
    mine.payout_amount
FROM royalty_statements rs
    CROSS JOIN LATERAL (
        SELECT COALESCE(sum(l.sale_count), 0)::bigint AS sale_count,
            COALESCE(sum(l.gross_amount), 0)::bigint AS gross_amount,
            COALESCE(sum(l.refunded_amount), 0)::bigint AS refunded_amount,
            COALESCE(sum(l.payout_amount), 0)::bigint AS payout_amount
        FROM royalty_statement_lines l
            JOIN creator_accounts ca ON ca.tenant_id = l.tenant_id
                AND ca.creator_id = l.creator_id
        WHERE l.tenant_id = rs.tenant_id
            AND l.statement_id = rs.id
            AND ca.user_id = sqlc.arg('user_id')
            AND ca.creator_id = sqlc.arg('creator_id')
    ) mine
WHERE rs.tenant_id = sqlc.arg('tenant_id')
    AND rs.period = sqlc.arg('period');

-- name: ListMyCreatorStatementLinesAsc :many
-- The creator's own lines of a statement in the order they were closed in,
-- read through the account's link to the creator as the sums are, with the
-- public IDs of the catalog rows that still exist and the month an adjustment
-- line adjusts.
SELECT l.line_number,
    l.series_title,
    l.episode_title,
    l.role_name,
    l.sale_count,
    l.gross_amount,
    l.refunded_amount,
    l.share_bps,
    l.payout_amount,
    l.source,
    s.public_id AS series_public_id,
    e.public_id AS episode_public_id,
    adjusted.period AS adjusted_period
FROM royalty_statement_lines l
    JOIN creator_accounts ca ON ca.tenant_id = l.tenant_id
        AND ca.creator_id = l.creator_id
    LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
    LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
    LEFT JOIN royalty_statements adjusted ON adjusted.tenant_id = l.tenant_id AND adjusted.id = l.adjusted_statement_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.statement_id = sqlc.arg('statement_id')
    AND ca.user_id = sqlc.arg('user_id')
    AND ca.creator_id = sqlc.arg('creator_id')
    AND l.line_number > sqlc.arg('after_line_number')::integer
ORDER BY l.line_number ASC
LIMIT sqlc.arg('row_limit');

-- name: ListMyCreatorStatementLinesDesc :many
-- ListMyCreatorStatementLinesAsc walked backwards, for a previous-page token.
SELECT l.line_number,
    l.series_title,
    l.episode_title,
    l.role_name,
    l.sale_count,
    l.gross_amount,
    l.refunded_amount,
    l.share_bps,
    l.payout_amount,
    l.source,
    s.public_id AS series_public_id,
    e.public_id AS episode_public_id,
    adjusted.period AS adjusted_period
FROM royalty_statement_lines l
    JOIN creator_accounts ca ON ca.tenant_id = l.tenant_id
        AND ca.creator_id = l.creator_id
    LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
    LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
    LEFT JOIN royalty_statements adjusted ON adjusted.tenant_id = l.tenant_id AND adjusted.id = l.adjusted_statement_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.statement_id = sqlc.arg('statement_id')
    AND ca.user_id = sqlc.arg('user_id')
    AND ca.creator_id = sqlc.arg('creator_id')
    AND l.line_number < sqlc.arg('before_line_number')::integer
ORDER BY l.line_number DESC
LIMIT sqlc.arg('row_limit');
