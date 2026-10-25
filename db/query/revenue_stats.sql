-- The console's revenue statistics: what a tenant's purchases earned over a
-- period of its own days, net of what went back to the readers.
--
-- Every query counts the same purchases: those made within the period, which
-- runs from the tenant's midnight of start_date to its midnight after
-- end_date in time_zone, paid in currency, the tenant's, and not made in a
-- store's sandbox or a payment provider's test mode, which paid the tenant
-- nothing. A purchase in another currency cannot be added to theirs. What went
-- back on a purchase is purchase_returned_amount, taken off the day the
-- purchase was made, so a refund leaves the sale counted and its money not.
--
-- The range of the period is read from idx_purchases_tenant_purchased_at_id_amounts,
-- which carries every column GetRevenueTotals and ListRevenueByDay read, so
-- those two answer from the index alone. The series and episode reports join
-- each purchase to its parts in purchase_episode_parts, and narrow the parts
-- to the period too, which is what keeps them from reading the parts of every
-- purchase the tenant ever made.

-- name: GetRevenueTotals :one
SELECT
    count(*)::bigint AS purchase_count,
    COALESCE(sum(p.price_at_purchase), 0)::bigint AS gross_amount,
    COALESCE(sum(purchase_returned_amount(p.price_at_purchase, p.refunded_amount, p.dispute_lost_at)), 0)::bigint AS refunded_amount
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND NOT p.is_test
    AND p.currency = sqlc.arg('currency')::text
    AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text);

-- name: ListRevenueByDay :many
-- Every day of the period in order, a day nothing sold on included, so a
-- chart of it has no gap to fill. The days are generated as timestamps without
-- a zone, so the session's own zone cannot move one onto the day before.
WITH sales AS (
    SELECT
        (p.purchased_at AT TIME ZONE sqlc.arg('time_zone')::text)::date AS sale_date,
        count(*)::bigint AS purchase_count,
        sum(p.price_at_purchase)::bigint AS gross_amount,
        sum(purchase_returned_amount(p.price_at_purchase, p.refunded_amount, p.dispute_lost_at))::bigint AS refunded_amount
    FROM purchases p
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND NOT p.is_test
        AND p.currency = sqlc.arg('currency')::text
        AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY 1
)
SELECT
    d.day::date AS sale_date,
    COALESCE(s.purchase_count, 0)::bigint AS purchase_count,
    COALESCE(s.gross_amount, 0)::bigint AS gross_amount,
    COALESCE(s.refunded_amount, 0)::bigint AS refunded_amount
FROM generate_series(
    sqlc.arg('start_date')::date::timestamp,
    sqlc.arg('end_date')::date::timestamp,
    interval '1 day'
) AS d(day)
LEFT JOIN sales s ON s.sale_date = d.day::date
ORDER BY d.day;

-- name: ListSeriesRevenueDesc :many
-- Each series that sold in the period, highest net first. A purchase is a sale
-- of the series its episodes belong to at what its parts there add up to, and
-- what went back on it is divided by the same proportion, so a purchase of a
-- volume or of the rest of a series, whose episodes are all of one series,
-- gives the series exactly what it gave the totals.
WITH parts AS (
    SELECT
        e.series_id,
        p.price_at_purchase,
        purchase_returned_amount(p.price_at_purchase, p.refunded_amount, p.dispute_lost_at) AS returned_amount,
        sum(pp.price)::integer AS price
    FROM purchases p
    JOIN purchase_episode_parts pp ON pp.tenant_id = p.tenant_id
        AND pp.purchase_id = p.id
        AND pp.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND pp.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    JOIN episodes e ON e.tenant_id = pp.tenant_id AND e.id = pp.episode_id
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND NOT p.is_test
        AND p.currency = sqlc.arg('currency')::text
        AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY e.series_id, p.id
),
revenue AS (
    SELECT
        parts.series_id,
        count(*)::bigint AS purchase_count,
        sum(parts.price)::bigint AS gross_amount,
        sum(episode_part_of_purchase_amount(parts.returned_amount, parts.price, parts.price_at_purchase))::bigint AS refunded_amount
    FROM parts
    GROUP BY parts.series_id
)
SELECT
    r.series_id,
    s.public_id AS series_public_id,
    str.title AS series_title,
    r.purchase_count,
    r.gross_amount,
    r.refunded_amount,
    (r.gross_amount - r.refunded_amount)::bigint AS net_amount
FROM revenue r
JOIN series s ON s.tenant_id = sqlc.arg('tenant_id') AND s.id = r.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') str
WHERE (
        sqlc.narg('cursor_series_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.series_id) <= (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.series_id) < (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
    )
ORDER BY r.gross_amount - r.refunded_amount DESC, r.series_id DESC
LIMIT sqlc.arg('limit');

-- name: ListSeriesRevenueAsc :many
-- ListSeriesRevenueDesc walked the other way, to build a previous page. The
-- order it describes is the same one.
WITH parts AS (
    SELECT
        e.series_id,
        p.price_at_purchase,
        purchase_returned_amount(p.price_at_purchase, p.refunded_amount, p.dispute_lost_at) AS returned_amount,
        sum(pp.price)::integer AS price
    FROM purchases p
    JOIN purchase_episode_parts pp ON pp.tenant_id = p.tenant_id
        AND pp.purchase_id = p.id
        AND pp.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND pp.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    JOIN episodes e ON e.tenant_id = pp.tenant_id AND e.id = pp.episode_id
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND NOT p.is_test
        AND p.currency = sqlc.arg('currency')::text
        AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY e.series_id, p.id
),
revenue AS (
    SELECT
        parts.series_id,
        count(*)::bigint AS purchase_count,
        sum(parts.price)::bigint AS gross_amount,
        sum(episode_part_of_purchase_amount(parts.returned_amount, parts.price, parts.price_at_purchase))::bigint AS refunded_amount
    FROM parts
    GROUP BY parts.series_id
)
SELECT
    r.series_id,
    s.public_id AS series_public_id,
    str.title AS series_title,
    r.purchase_count,
    r.gross_amount,
    r.refunded_amount,
    (r.gross_amount - r.refunded_amount)::bigint AS net_amount
FROM revenue r
JOIN series s ON s.tenant_id = sqlc.arg('tenant_id') AND s.id = r.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') str
WHERE (
        sqlc.narg('cursor_series_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.series_id) >= (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.series_id) > (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
    )
ORDER BY r.gross_amount - r.refunded_amount ASC, r.series_id ASC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeRevenueDesc :many
-- Each episode that sold in the period, highest net first. A purchase is a
-- sale of each episode it paid for at the part of its price that episode
-- accounts for, and what went back on it is divided the way a royalty
-- statement divides a refund.
WITH revenue AS (
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
        AND pp.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND pp.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND NOT p.is_test
        AND p.currency = sqlc.arg('currency')::text
        AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY pp.episode_id
)
SELECT
    r.episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title,
    r.purchase_count,
    r.gross_amount,
    r.refunded_amount,
    (r.gross_amount - r.refunded_amount)::bigint AS net_amount
FROM revenue r
JOIN episodes e ON e.tenant_id = sqlc.arg('tenant_id') AND e.id = r.episode_id
CROSS JOIN LATERAL episode_translation_for(e.id, '') et
JOIN series s ON s.tenant_id = e.tenant_id AND s.id = e.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') str
WHERE (
        sqlc.narg('cursor_episode_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.episode_id) <= (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.episode_id) < (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
    )
ORDER BY r.gross_amount - r.refunded_amount DESC, r.episode_id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeRevenueAsc :many
-- ListEpisodeRevenueDesc walked the other way, to build a previous page. The
-- order it describes is the same one.
WITH revenue AS (
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
        AND pp.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND pp.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND NOT p.is_test
        AND p.currency = sqlc.arg('currency')::text
        AND p.purchased_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND p.purchased_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY pp.episode_id
)
SELECT
    r.episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title,
    r.purchase_count,
    r.gross_amount,
    r.refunded_amount,
    (r.gross_amount - r.refunded_amount)::bigint AS net_amount
FROM revenue r
JOIN episodes e ON e.tenant_id = sqlc.arg('tenant_id') AND e.id = r.episode_id
CROSS JOIN LATERAL episode_translation_for(e.id, '') et
JOIN series s ON s.tenant_id = e.tenant_id AND s.id = e.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') str
WHERE (
        sqlc.narg('cursor_episode_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.episode_id) >= (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.gross_amount - r.refunded_amount, r.episode_id) > (
                sqlc.narg('cursor_net_amount')::bigint,
                sqlc.narg('cursor_episode_id')::uuid
            )
        )
    )
ORDER BY r.gross_amount - r.refunded_amount ASC, r.episode_id ASC
LIMIT sqlc.arg('limit');
