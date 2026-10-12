-- name: GetRoyaltyMonthBounds :one
-- The instants a tenant month runs between. A month starts where the statement
-- of the month before it ended, and ends where the statement of the month
-- after it started; a neighbour not closed yet leaves that bound at the
-- month's own midnight in the given zone, the tenant's current one. A closed
-- month's bounds never move, so a tenant that changes its zone between two
-- closes leaves no hour in neither month and none in both.
SELECT
    COALESCE(
        (
            SELECT rs.ends_at
            FROM royalty_statements rs
            WHERE rs.tenant_id = sqlc.arg('tenant_id')
                AND rs.period = (sqlc.arg('period')::date - interval '1 month')::date
        ),
        sqlc.arg('period')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text
    )::timestamptz AS starts_at,
    COALESCE(
        (
            SELECT rs.starts_at
            FROM royalty_statements rs
            WHERE rs.tenant_id = sqlc.arg('tenant_id')
                AND rs.period = (sqlc.arg('period')::date + interval '1 month')::date
        ),
        (sqlc.arg('period')::date + interval '1 month')::timestamp AT TIME ZONE sqlc.arg('time_zone')::text
    )::timestamptz AS ends_at;

-- name: ListRoyaltyLinesForPeriod :many
-- Computes the lines of one tenant month: every credit on an episode sold in
-- the month, with the month's sales of that episode. It is what a close
-- writes and what a preview shows, so the two cannot disagree.
--
-- The month runs between the bounds GetRoyaltyMonthBounds answers for it. A
-- fully refunded sale is not a sale; a partial refund stays a sale and is
-- carried as refunded_amount. A test purchase, from a store's sandbox or a
-- payment provider's test mode, paid the tenant nothing and is not a sale
-- either, and neither is one paid in a currency other than the one asked
-- for, the tenant's: its price cannot be added to theirs. The payout is
-- floored per line over the month's sum, which keeps the rounding loss to one
-- minor unit of the currency per line.
SELECT
    ec.creator_id,
    c.public_id AS creator_public_id,
    c.name AS creator_name,
    s.id AS series_id,
    s.public_id AS series_public_id,
    s.title AS series_title,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    ec.role_id,
    r.public_id AS role_public_id,
    r.name AS role_name,
    count(*)::integer AS sale_count,
    sum(p.price_at_purchase)::bigint AS gross_amount,
    sum(COALESCE(p.refunded_amount, 0))::bigint AS refunded_amount,
    ec.share_bps,
    ((sum(p.price_at_purchase) - sum(COALESCE(p.refunded_amount, 0))) * ec.share_bps / 10000)::bigint AS payout_amount
FROM purchases p
JOIN episodes e ON e.tenant_id = p.tenant_id AND e.id = p.episode_id
JOIN series s ON s.tenant_id = e.tenant_id AND s.id = e.series_id
JOIN episode_creators ec ON ec.tenant_id = p.tenant_id AND ec.episode_id = p.episode_id
JOIN creators c ON c.tenant_id = ec.tenant_id AND c.id = ec.creator_id
LEFT JOIN creator_roles r ON r.tenant_id = ec.tenant_id AND r.id = ec.role_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.refunded_at IS NULL
    AND NOT p.is_test
    AND p.currency = sqlc.arg('currency')::text
    AND p.purchased_at >= sqlc.arg('starts_at')::timestamptz
    AND p.purchased_at < sqlc.arg('ends_at')::timestamptz
GROUP BY
    s.id, s.public_id, s.title,
    e.id, e.public_id, e.title, e.order_index,
    ec.creator_id, c.public_id, c.name,
    ec.role_id, r.public_id, r.name,
    ec.display_order, ec.share_bps
ORDER BY s.title, s.id, e.order_index, e.id, ec.display_order, ec.creator_id, ec.role_id NULLS FIRST;

-- name: GetRoyaltySalesTotalsForPeriod :one
-- Totals the month's sales once each, however many creators a sale is
-- credited to. The month, the refund rule, and the currency are those of
-- ListRoyaltyLinesForPeriod.
SELECT
    COALESCE(sum(p.price_at_purchase), 0)::bigint AS total_gross,
    COALESCE(sum(COALESCE(p.refunded_amount, 0)), 0)::bigint AS total_refunded
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.refunded_at IS NULL
    AND NOT p.is_test
    AND p.currency = sqlc.arg('currency')::text
    AND p.purchased_at >= sqlc.arg('starts_at')::timestamptz
    AND p.purchased_at < sqlc.arg('ends_at')::timestamptz;

-- name: ListRoyaltyAdjustmentLinesForPeriod :many
-- Computes the adjustment lines of one tenant month: for each line of a
-- statement of an earlier month, the refunds recorded on its sales since they
-- were counted, at the share that line applied and under the names it was
-- closed with. A credit added or edited since that close changes nothing
-- here. A sale in another currency than the one asked for was never counted
-- by a statement in it.
--
-- The payout is what the refunds take off the adjusted line's payout: the
-- line's net after them times its share, floored as the line was, less the
-- same over its net before them, which is the line's own net and every
-- adjustment it has had since. A statement lists these after the month's own
-- lines, oldest adjusted month first.
WITH carried AS (
    SELECT
        u.tenant_id,
        u.statement_id,
        u.period,
        u.episode_id,
        sum(u.sale_count)::integer AS sale_count,
        sum(u.gross_amount)::bigint AS gross_amount,
        sum(u.refunded_amount)::bigint AS refunded_amount
    FROM royalty_uncarried_refunds u
    WHERE u.tenant_id = sqlc.arg('tenant_id')
        AND u.currency = sqlc.arg('currency')::text
        AND u.period < sqlc.arg('period')::date
    GROUP BY u.tenant_id, u.statement_id, u.period, u.episode_id
)
SELECT
    l.creator_id,
    c.public_id AS creator_public_id,
    l.creator_name,
    l.series_id,
    s.public_id AS series_public_id,
    l.series_title,
    l.episode_id,
    e.public_id AS episode_public_id,
    l.episode_title,
    l.role_id,
    r.public_id AS role_public_id,
    l.role_name,
    l.statement_id AS adjusted_statement_id,
    l.line_number AS adjusted_line_number,
    carried.period AS adjusted_period,
    carried.sale_count,
    carried.gross_amount,
    carried.refunded_amount,
    l.share_bps,
    (
        (counted.net + carried.gross_amount - carried.refunded_amount) * l.share_bps / 10000
        - counted.net * l.share_bps / 10000
    )::bigint AS payout_amount
FROM carried
JOIN royalty_statement_lines l ON l.tenant_id = carried.tenant_id
    AND l.statement_id = carried.statement_id
    AND l.episode_id = carried.episode_id
    AND l.adjusted_statement_id IS NULL
CROSS JOIN LATERAL (
    SELECT (
        l.gross_amount - l.refunded_amount
        + COALESCE(sum(a.gross_amount - a.refunded_amount), 0)
    )::bigint AS net
    FROM royalty_statement_lines a
    WHERE a.tenant_id = l.tenant_id
        AND a.adjusted_statement_id = l.statement_id
        AND a.adjusted_line_number = l.line_number
) counted
LEFT JOIN creators c ON c.tenant_id = l.tenant_id AND c.id = l.creator_id
LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
LEFT JOIN creator_roles r ON r.tenant_id = l.tenant_id AND r.id = l.role_id
ORDER BY carried.period, l.line_number;

-- name: GetRoyaltyAdjustmentTotalForPeriod :one
-- Totals what ListRoyaltyAdjustmentLinesForPeriod takes back, each refunded
-- sale counted once however many creators it is credited to.
SELECT
    COALESCE(sum(u.gross_amount - u.refunded_amount), 0)::bigint AS total_adjustment
FROM royalty_uncarried_refunds u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.currency = sqlc.arg('currency')::text
    AND u.period < sqlc.arg('period')::date;

-- name: InsertRoyaltyStatement :one
-- A second close of the same month fails on royalty_statements_tenant_id_period_key.
INSERT INTO royalty_statements (
    id,
    tenant_id,
    period,
    time_zone,
    starts_at,
    ends_at,
    closed_by_user_id,
    currency,
    total_gross,
    total_refunded,
    total_adjustment,
    total_payout
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('period'),
    sqlc.arg('time_zone'),
    sqlc.arg('starts_at'),
    sqlc.arg('ends_at'),
    sqlc.narg('closed_by_user_id'),
    sqlc.arg('currency'),
    sqlc.arg('total_gross'),
    sqlc.arg('total_refunded'),
    sqlc.arg('total_adjustment'),
    sqlc.arg('total_payout')
)
RETURNING *;

-- name: InsertRoyaltyStatementLines :exec
-- Writes every line of a statement in one statement. The lines travel as one
-- JSON array because several of their columns are nullable, which a typed
-- array parameter per column cannot carry.
INSERT INTO royalty_statement_lines (
    tenant_id,
    statement_id,
    line_number,
    creator_id,
    creator_name,
    series_id,
    series_title,
    episode_id,
    episode_title,
    role_id,
    role_name,
    sale_count,
    gross_amount,
    refunded_amount,
    share_bps,
    payout_amount,
    adjusted_statement_id,
    adjusted_line_number
)
SELECT
    sqlc.arg('tenant_id'),
    sqlc.arg('statement_id'),
    line.line_number,
    line.creator_id,
    line.creator_name,
    line.series_id,
    line.series_title,
    line.episode_id,
    line.episode_title,
    line.role_id,
    line.role_name,
    line.sale_count,
    line.gross_amount,
    line.refunded_amount,
    line.share_bps,
    line.payout_amount,
    line.adjusted_statement_id,
    line.adjusted_line_number
FROM jsonb_to_recordset(sqlc.arg('lines')::jsonb) AS line(
    line_number integer,
    creator_id uuid,
    creator_name text,
    series_id uuid,
    series_title text,
    episode_id uuid,
    episode_title text,
    role_id uuid,
    role_name text,
    sale_count integer,
    gross_amount bigint,
    refunded_amount bigint,
    share_bps integer,
    payout_amount bigint,
    adjusted_statement_id uuid,
    adjusted_line_number integer
);

-- name: InsertRoyaltyStatementPurchases :exec
-- Writes down what a statement counted of each purchase: every sale of its
-- own month, by the rules of ListRoyaltyLinesForPeriod, and the change it
-- carries of each sale ListRoyaltyAdjustmentLinesForPeriod adjusts. Both
-- halves read the purchases as they stood before this statement, which is the
-- snapshot the lines were computed in.
INSERT INTO royalty_statement_purchases (
    tenant_id,
    purchase_id,
    statement_id,
    sale_count,
    gross_amount,
    refunded_amount
)
SELECT
    p.tenant_id,
    p.id AS purchase_id,
    sqlc.arg('statement_id')::uuid AS statement_id,
    1 AS sale_count,
    p.price_at_purchase AS gross_amount,
    COALESCE(p.refunded_amount, 0) AS refunded_amount
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.refunded_at IS NULL
    AND NOT p.is_test
    AND p.currency = sqlc.arg('currency')::text
    AND p.purchased_at >= sqlc.arg('starts_at')::timestamptz
    AND p.purchased_at < sqlc.arg('ends_at')::timestamptz
UNION ALL
SELECT
    u.tenant_id,
    u.purchase_id,
    sqlc.arg('statement_id')::uuid AS statement_id,
    u.sale_count,
    u.gross_amount::integer AS gross_amount,
    u.refunded_amount::integer AS refunded_amount
FROM royalty_uncarried_refunds u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.currency = sqlc.arg('currency')::text
    AND u.period < sqlc.arg('period')::date;

-- name: GetRoyaltyStatementByPeriod :one
SELECT
    rs.*,
    u.public_id AS closed_by_user_public_id,
    u.name AS closed_by_user_name
FROM royalty_statements rs
LEFT JOIN users u ON u.tenant_id = rs.tenant_id AND u.id = rs.closed_by_user_id
WHERE rs.tenant_id = sqlc.arg('tenant_id')
    AND rs.period = sqlc.arg('period');

-- name: ListRoyaltyStatementPeriodsFrom :many
-- The months of a tenant already closed, from a month on, for the automatic
-- close to tell which of the months it owes are still open.
SELECT period
FROM royalty_statements
WHERE tenant_id = sqlc.arg('tenant_id')
    AND period >= sqlc.arg('from_period')::date
ORDER BY period;

-- name: ListRoyaltyStatementsDesc :many
-- Newest month first. The period is unique per tenant, so it alone is the
-- keyset.
SELECT
    rs.*,
    u.public_id AS closed_by_user_public_id,
    u.name AS closed_by_user_name
FROM royalty_statements rs
LEFT JOIN users u ON u.tenant_id = rs.tenant_id AND u.id = rs.closed_by_user_id
WHERE rs.tenant_id = sqlc.arg('tenant_id')
    AND (
        NOT sqlc.arg('has_cursor')::boolean
        OR rs.period < sqlc.arg('cursor_period')::date
    )
ORDER BY rs.period DESC
LIMIT sqlc.arg('row_limit');

-- name: ListRoyaltyStatementsAsc :many
-- ListRoyaltyStatementsDesc walked backwards, for a previous-page token.
SELECT
    rs.*,
    u.public_id AS closed_by_user_public_id,
    u.name AS closed_by_user_name
FROM royalty_statements rs
LEFT JOIN users u ON u.tenant_id = rs.tenant_id AND u.id = rs.closed_by_user_id
WHERE rs.tenant_id = sqlc.arg('tenant_id')
    AND rs.period > sqlc.arg('cursor_period')::date
ORDER BY rs.period ASC
LIMIT sqlc.arg('row_limit');

-- name: ListRoyaltyStatementLinesAsc :many
-- The lines of a statement in the order they were closed in, with the public
-- IDs of the catalog rows that still exist and the month an adjustment line
-- adjusts.
SELECT
    l.*,
    c.public_id AS creator_public_id,
    s.public_id AS series_public_id,
    e.public_id AS episode_public_id,
    r.public_id AS role_public_id,
    adjusted.period AS adjusted_period
FROM royalty_statement_lines l
LEFT JOIN creators c ON c.tenant_id = l.tenant_id AND c.id = l.creator_id
LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
LEFT JOIN creator_roles r ON r.tenant_id = l.tenant_id AND r.id = l.role_id
LEFT JOIN royalty_statements adjusted ON adjusted.tenant_id = l.tenant_id AND adjusted.id = l.adjusted_statement_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.statement_id = sqlc.arg('statement_id')
    AND l.line_number > sqlc.arg('after_line_number')::integer
ORDER BY l.line_number ASC
LIMIT sqlc.arg('row_limit');

-- name: ListRoyaltyStatementLinesDesc :many
-- ListRoyaltyStatementLinesAsc walked backwards, for a previous-page token.
SELECT
    l.*,
    c.public_id AS creator_public_id,
    s.public_id AS series_public_id,
    e.public_id AS episode_public_id,
    r.public_id AS role_public_id,
    adjusted.period AS adjusted_period
FROM royalty_statement_lines l
LEFT JOIN creators c ON c.tenant_id = l.tenant_id AND c.id = l.creator_id
LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
LEFT JOIN creator_roles r ON r.tenant_id = l.tenant_id AND r.id = l.role_id
LEFT JOIN royalty_statements adjusted ON adjusted.tenant_id = l.tenant_id AND adjusted.id = l.adjusted_statement_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.statement_id = sqlc.arg('statement_id')
    AND l.line_number < sqlc.arg('before_line_number')::integer
ORDER BY l.line_number DESC
LIMIT sqlc.arg('row_limit');

-- name: ListRoyaltyStatementLinesForExport :many
-- Every line of a statement as it was closed, for the CSV export. It reads the
-- stored columns only, and the period of a statement that is never deleted
-- while the tenant exists, so the export of a closed month never changes.
SELECT
    l.*,
    adjusted.period AS adjusted_period
FROM royalty_statement_lines l
LEFT JOIN royalty_statements adjusted ON adjusted.tenant_id = l.tenant_id AND adjusted.id = l.adjusted_statement_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.statement_id = sqlc.arg('statement_id')
ORDER BY l.line_number ASC;
