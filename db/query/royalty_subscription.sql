-- The subscription lines of a royalty statement: the payments of plans whose
-- period ends in a tenant month, each shared among the episodes of its plan
-- its subscriber finished in that period, as subscription_payment_episode_parts
-- divides it.
--
-- Every query here counts the same payments: those whose period ends within
-- the bounds GetRoyaltyMonthBounds answers for the month, paid in currency,
-- the tenant's, not made in Stripe's test mode, which paid the tenant nothing,
-- not refunded in full, and not lost to a dispute. A partial refund stays
-- shared and is carried as refunded_amount, divided over the parts by
-- episode_part_of_purchase_amount as a purchase's is. A lost dispute is no
-- sale, as a payment refunded in full is. A payment no part of which falls on
-- anyone is in no line and in no total: it is the tenant's revenue alone.

-- name: ListRoyaltySubscriptionLinesForPeriod :many
-- Computes the subscription lines of one tenant month: every credit on an
-- episode a payment of the month was shared to, with the parts of the
-- month's payments that fall on it. sale_count is how many payments did. It
-- is what a close writes and what a preview shows, so the two cannot
-- disagree, and its columns and order are those of ListRoyaltyLinesForPeriod.
SELECT
    ec.creator_id,
    c.public_id AS creator_public_id,
    c.name AS creator_name,
    s.id AS series_id,
    s.public_id AS series_public_id,
    str.title AS series_title,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    ec.role_id,
    r.public_id AS role_public_id,
    r.name AS role_name,
    count(*)::integer AS sale_count,
    sum(pp.price)::bigint AS gross_amount,
    sum(part.refunded_amount)::bigint AS refunded_amount,
    ec.share_bps,
    ((sum(pp.price) - sum(part.refunded_amount)) * ec.share_bps / 10000)::bigint AS payout_amount
FROM subscription_payments sp
JOIN subscription_payment_episode_parts pp ON pp.tenant_id = sp.tenant_id
    AND pp.subscription_payment_id = sp.id
    AND pp.period_end >= sqlc.arg('starts_at')::timestamptz
    AND pp.period_end < sqlc.arg('ends_at')::timestamptz
CROSS JOIN LATERAL (
    SELECT episode_part_of_purchase_amount(COALESCE(sp.refunded_amount, 0), pp.price, sp.amount) AS refunded_amount
) part
JOIN episodes e ON e.tenant_id = pp.tenant_id AND e.id = pp.episode_id
CROSS JOIN LATERAL episode_translation_for(e.id, '') et
JOIN series s ON s.tenant_id = e.tenant_id AND s.id = e.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') str
JOIN episode_creators ec ON ec.tenant_id = pp.tenant_id AND ec.episode_id = pp.episode_id
JOIN creators c ON c.tenant_id = ec.tenant_id AND c.id = ec.creator_id
LEFT JOIN creator_roles r ON r.tenant_id = ec.tenant_id AND r.id = ec.role_id
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND COALESCE(sp.refunded_amount, 0) < sp.amount
    AND sp.dispute_lost_at IS NULL
    AND NOT sp.is_test
    AND sp.currency = sqlc.arg('currency')::text
    AND sp.period_end >= sqlc.arg('starts_at')::timestamptz
    AND sp.period_end < sqlc.arg('ends_at')::timestamptz
GROUP BY
    s.id, s.public_id, str.title,
    e.id, e.public_id, et.title, e.order_index,
    ec.creator_id, c.public_id, c.name,
    ec.role_id, r.public_id, r.name,
    ec.display_order, ec.share_bps
ORDER BY str.title, s.id, e.order_index, e.id, ec.display_order, ec.creator_id, ec.role_id NULLS FIRST;

-- name: GetRoyaltySubscriptionTotalsForPeriod :one
-- Totals the month's shared payments once each, however many episodes and
-- creators a payment is shared to.
SELECT
    COALESCE(sum(sp.amount), 0)::bigint AS total_gross,
    COALESCE(sum(COALESCE(sp.refunded_amount, 0)), 0)::bigint AS total_refunded
FROM subscription_payments sp
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND COALESCE(sp.refunded_amount, 0) < sp.amount
    AND sp.dispute_lost_at IS NULL
    AND NOT sp.is_test
    AND sp.currency = sqlc.arg('currency')::text
    AND sp.period_end >= sqlc.arg('starts_at')::timestamptz
    AND sp.period_end < sqlc.arg('ends_at')::timestamptz
    AND EXISTS (
        SELECT 1
        FROM subscription_payment_episode_parts pp
        WHERE pp.tenant_id = sp.tenant_id
            AND pp.subscription_payment_id = sp.id
    );

-- name: InsertRoyaltyStatementSubscriptionParts :exec
-- Writes down the parts the month's payments were shared by, as the lines
-- were computed from them in the same snapshot, so a refund carried later is
-- divided the way the close divided the payment.
INSERT INTO royalty_statement_subscription_parts (
    tenant_id,
    statement_id,
    subscription_payment_id,
    episode_id,
    price
)
SELECT
    sp.tenant_id,
    sqlc.arg('statement_id')::uuid AS statement_id,
    pp.subscription_payment_id,
    pp.episode_id,
    pp.price
FROM subscription_payments sp
JOIN subscription_payment_episode_parts pp ON pp.tenant_id = sp.tenant_id
    AND pp.subscription_payment_id = sp.id
    AND pp.period_end >= sqlc.arg('starts_at')::timestamptz
    AND pp.period_end < sqlc.arg('ends_at')::timestamptz
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND COALESCE(sp.refunded_amount, 0) < sp.amount
    AND sp.dispute_lost_at IS NULL
    AND NOT sp.is_test
    AND sp.currency = sqlc.arg('currency')::text
    AND sp.period_end >= sqlc.arg('starts_at')::timestamptz
    AND sp.period_end < sqlc.arg('ends_at')::timestamptz;

-- name: InsertRoyaltyStatementSubscriptionPayments :exec
-- Writes down what a statement counted of each subscription payment, as
-- InsertRoyaltyStatementPurchases does of each purchase: every payment of its
-- own month it shared, and the change it carries of each payment
-- ListRoyaltyAdjustmentLinesForPeriod adjusts. Both halves read the payments
-- as they stood before this statement, which is the snapshot the lines were
-- computed in.
INSERT INTO royalty_statement_subscription_payments (
    tenant_id,
    subscription_payment_id,
    statement_id,
    sale_count,
    gross_amount,
    refunded_amount
)
SELECT
    sp.tenant_id,
    sp.id AS subscription_payment_id,
    sqlc.arg('statement_id')::uuid AS statement_id,
    1 AS sale_count,
    sp.amount AS gross_amount,
    COALESCE(sp.refunded_amount, 0) AS refunded_amount
FROM subscription_payments sp
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND COALESCE(sp.refunded_amount, 0) < sp.amount
    AND sp.dispute_lost_at IS NULL
    AND NOT sp.is_test
    AND sp.currency = sqlc.arg('currency')::text
    AND sp.period_end >= sqlc.arg('starts_at')::timestamptz
    AND sp.period_end < sqlc.arg('ends_at')::timestamptz
    AND EXISTS (
        SELECT 1
        FROM subscription_payment_episode_parts pp
        WHERE pp.tenant_id = sp.tenant_id
            AND pp.subscription_payment_id = sp.id
    )
UNION ALL
SELECT
    u.tenant_id,
    u.subscription_payment_id,
    sqlc.arg('statement_id')::uuid AS statement_id,
    u.sale_count,
    u.gross_amount::integer AS gross_amount,
    u.refunded_amount::integer AS refunded_amount
FROM royalty_uncarried_subscription_refunds u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.currency = sqlc.arg('currency')::text
    AND u.period < sqlc.arg('period')::date;
