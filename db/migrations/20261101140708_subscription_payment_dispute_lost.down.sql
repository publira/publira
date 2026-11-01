-- VIEW: royalty_uncarried_subscription_refunds
CREATE OR REPLACE VIEW royalty_uncarried_subscription_refunds WITH (security_invoker = true) AS
SELECT sp.tenant_id,
    sp.id AS subscription_payment_id,
    sp.currency,
    rs.id AS statement_id,
    rs.period,
    (cur.sale_count - counted.sale_count)::integer AS sale_count,
    (cur.gross_amount - counted.gross_amount)::bigint AS gross_amount,
    (cur.refunded_amount - counted.refunded_amount)::bigint AS refunded_amount,
    counted.refunded_amount::bigint AS counted_refunded_amount
FROM subscription_payments sp
    JOIN royalty_statement_subscription_payments sale ON sale.tenant_id = sp.tenant_id
    AND sale.subscription_payment_id = sp.id
    AND sale.sale_count = 1
    JOIN royalty_statements rs ON rs.tenant_id = sale.tenant_id
    AND rs.id = sale.statement_id
    CROSS JOIN LATERAL (
        SELECT sum(rssp.sale_count) AS sale_count,
            sum(rssp.gross_amount) AS gross_amount,
            sum(rssp.refunded_amount) AS refunded_amount
        FROM royalty_statement_subscription_payments rssp
        WHERE rssp.tenant_id = sp.tenant_id
            AND rssp.subscription_payment_id = sp.id
    ) counted
    CROSS JOIN LATERAL (
        SELECT CASE WHEN sp.refunded_amount < sp.amount THEN 1 ELSE 0 END AS sale_count,
            CASE WHEN sp.refunded_amount < sp.amount THEN sp.amount ELSE 0 END AS gross_amount,
            CASE WHEN sp.refunded_amount < sp.amount THEN sp.refunded_amount ELSE 0 END AS refunded_amount
    ) cur
WHERE sp.refunded_amount IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;

ALTER TABLE subscription_payments
    DROP COLUMN dispute_lost_at;
