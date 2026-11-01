-- A dispute the reader's bank decided against the tenant takes a subscription
-- payment back for good, and the provider reports that as the dispute's
-- outcome, never as a refund. The subscription follows Stripe's own state:
-- losing the dispute is about the money, which revenue then counts as refunded
-- in full and a royalty statement no longer shares.

-- COLUMN: subscription_payments dispute_lost_at
-- When the provider reported the payment's dispute lost. NULL is a payment
-- never disputed, one whose dispute is still open, and one whose dispute the
-- tenant won, which stays a sale. Nullable, so the previous release's inserts
-- leave it unset.
ALTER TABLE subscription_payments
    ADD COLUMN dispute_lost_at timestamp with time zone;

-- VIEW: royalty_uncarried_subscription_refunds
-- Each subscription payment a statement shared whose net, its amount less
-- what went back, has fallen since, with the change still to be carried and
-- the statement that shared it. A payment counts as a sale while it is neither
-- refunded in full nor lost to a dispute, so a lost dispute is carried as a
-- full refund is. A close carries the rows of statements of earlier months
-- than its own, and a preview shows the same rows, so the two cannot disagree.
--
-- Only a payment with a refund or a lost dispute on it can have a row, which
-- is what keeps a close from summing every payment the tenant was ever paid.
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
        SELECT CASE WHEN sp.dispute_lost_at IS NULL AND sp.refunded_amount < sp.amount THEN 1 ELSE 0 END AS sale_count,
            CASE WHEN sp.dispute_lost_at IS NULL AND sp.refunded_amount < sp.amount THEN sp.amount ELSE 0 END AS gross_amount,
            CASE WHEN sp.dispute_lost_at IS NULL AND sp.refunded_amount < sp.amount THEN sp.refunded_amount ELSE 0 END AS refunded_amount
    ) cur
WHERE (sp.refunded_amount IS NOT NULL OR sp.dispute_lost_at IS NOT NULL)
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;
