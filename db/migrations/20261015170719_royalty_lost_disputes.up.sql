-- CONSTRAINT: purchases purchases_dispute_lost_revokes_check
-- VALIDATE takes a SHARE UPDATE EXCLUSIVE lock, under which reads and writes of
-- purchases go on while the rows already there are checked.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_dispute_lost_revokes_check;

-- VIEW: royalty_uncarried_refunds
-- Each purchase a statement has counted whose net, its price less its refund,
-- has fallen since, with the change still to be carried and the statement of
-- the month it was sold in. A purchase counts as a sale while it is neither
-- refunded in full nor lost to a dispute, the rule the month's own lines
-- apply, so a lost dispute is carried as a full refund is. A close carries the
-- rows of statements of earlier months than its own, and a preview shows the
-- same rows, so the two cannot disagree.
--
-- Only a purchase with a refund or a lost dispute on it can have a row, which
-- is what keeps a close from summing every purchase the tenant ever sold.
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
        CASE WHEN p.refunded_at IS NULL AND p.dispute_lost_at IS NULL THEN 1 ELSE 0 END AS sale_count,
        CASE WHEN p.refunded_at IS NULL AND p.dispute_lost_at IS NULL THEN p.price_at_purchase ELSE 0 END AS gross_amount,
        CASE WHEN p.refunded_at IS NULL AND p.dispute_lost_at IS NULL THEN COALESCE(p.refunded_amount, 0) ELSE 0 END AS refunded_amount
) cur
WHERE (p.refunded_amount IS NOT NULL OR p.dispute_lost_at IS NOT NULL)
    AND counted.sale_count IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;
