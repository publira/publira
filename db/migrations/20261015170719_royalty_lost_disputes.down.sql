-- The constraint stays validated: the previous migration's down drops it,
-- which it can whether it was validated or not.

-- VIEW: royalty_uncarried_refunds
CREATE OR REPLACE VIEW royalty_uncarried_refunds WITH (security_invoker = true) AS
SELECT
    p.tenant_id,
    p.id AS purchase_id,
    p.episode_id,
    p.currency,
    rs.id AS statement_id,
    rs.period,
    (cur.sale_count - counted.sale_count)::integer AS sale_count,
    (cur.gross_amount - counted.gross_amount)::bigint AS gross_amount,
    (cur.refunded_amount - counted.refunded_amount)::bigint AS refunded_amount
FROM purchases p
JOIN royalty_statements rs ON rs.tenant_id = p.tenant_id
    AND p.purchased_at >= rs.starts_at
    AND p.purchased_at < rs.ends_at
CROSS JOIN LATERAL (
    SELECT
        sum(rsp.sale_count) AS sale_count,
        sum(rsp.gross_amount) AS gross_amount,
        sum(rsp.refunded_amount) AS refunded_amount
    FROM royalty_statement_purchases rsp
    WHERE rsp.tenant_id = p.tenant_id
        AND rsp.purchase_id = p.id
) counted
CROSS JOIN LATERAL (
    SELECT
        CASE WHEN p.refunded_at IS NULL THEN 1 ELSE 0 END AS sale_count,
        CASE WHEN p.refunded_at IS NULL THEN p.price_at_purchase ELSE 0 END AS gross_amount,
        CASE WHEN p.refunded_at IS NULL THEN COALESCE(p.refunded_amount, 0) ELSE 0 END AS refunded_amount
) cur
WHERE p.refunded_amount IS NOT NULL
    AND counted.sale_count IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;
