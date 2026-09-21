-- name: ListRoyaltyLinesForPeriod :many
-- Computes the lines of one tenant month: every credit on an episode sold in
-- the month, with the month's sales of that episode. It is what a close
-- writes and what a preview shows, so the two cannot disagree.
--
-- The month runs from the first day's midnight to the next month's in the
-- given zone. A fully refunded sale is not a sale; a partial refund stays a
-- sale and is carried as refunded_amount. The payout is floored per line over
-- the month's sum, which keeps the rounding loss to one yen per line.
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
    AND p.purchased_at >= (sqlc.arg('period')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    AND p.purchased_at < ((sqlc.arg('period')::date + interval '1 month')::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
GROUP BY
    s.id, s.public_id, s.title,
    e.id, e.public_id, e.title, e.order_index,
    ec.creator_id, c.public_id, c.name,
    ec.role_id, r.public_id, r.name,
    ec.display_order, ec.share_bps
ORDER BY s.title, s.id, e.order_index, e.id, ec.display_order, ec.creator_id, ec.role_id NULLS FIRST;

-- name: GetRoyaltySalesTotalsForPeriod :one
-- Totals the month's sales once each, however many creators a sale is
-- credited to. The month and the refund rule are those of
-- ListRoyaltyLinesForPeriod.
SELECT
    COALESCE(sum(p.price_at_purchase), 0)::bigint AS total_gross,
    COALESCE(sum(COALESCE(p.refunded_amount, 0)), 0)::bigint AS total_refunded
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.refunded_at IS NULL
    AND p.purchased_at >= (sqlc.arg('period')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    AND p.purchased_at < ((sqlc.arg('period')::date + interval '1 month')::timestamp AT TIME ZONE sqlc.arg('time_zone')::text);

-- name: InsertRoyaltyStatement :one
-- A second close of the same month fails on royalty_statements_tenant_id_period_key.
INSERT INTO royalty_statements (
    id,
    tenant_id,
    period,
    time_zone,
    closed_by_user_id,
    total_gross,
    total_refunded,
    total_payout
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('period'),
    sqlc.arg('time_zone'),
    sqlc.narg('closed_by_user_id'),
    sqlc.arg('total_gross'),
    sqlc.arg('total_refunded'),
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
    payout_amount
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
    line.payout_amount
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
    payout_amount bigint
);

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
-- IDs of the catalog rows that still exist.
SELECT
    l.*,
    c.public_id AS creator_public_id,
    s.public_id AS series_public_id,
    e.public_id AS episode_public_id,
    r.public_id AS role_public_id
FROM royalty_statement_lines l
LEFT JOIN creators c ON c.tenant_id = l.tenant_id AND c.id = l.creator_id
LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
LEFT JOIN creator_roles r ON r.tenant_id = l.tenant_id AND r.id = l.role_id
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
    r.public_id AS role_public_id
FROM royalty_statement_lines l
LEFT JOIN creators c ON c.tenant_id = l.tenant_id AND c.id = l.creator_id
LEFT JOIN series s ON s.tenant_id = l.tenant_id AND s.id = l.series_id
LEFT JOIN episodes e ON e.tenant_id = l.tenant_id AND e.id = l.episode_id
LEFT JOIN creator_roles r ON r.tenant_id = l.tenant_id AND r.id = l.role_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.statement_id = sqlc.arg('statement_id')
    AND l.line_number < sqlc.arg('before_line_number')::integer
ORDER BY l.line_number DESC
LIMIT sqlc.arg('row_limit');

-- name: ListRoyaltyStatementLinesForExport :many
-- Every line of a statement as it was closed, for the CSV export. It reads the
-- stored columns only, so the export of a closed month never changes.
SELECT *
FROM royalty_statement_lines
WHERE tenant_id = sqlc.arg('tenant_id')
    AND statement_id = sqlc.arg('statement_id')
ORDER BY line_number ASC;
