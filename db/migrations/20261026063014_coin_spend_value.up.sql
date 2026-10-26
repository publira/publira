-- A sale paid with coins is a sale at what its coins were paid for. A spent
-- coin is worth its pack's price spread over every coin of the pack, the bonus
-- coins included, so the tenant bears a bonus as the discount it is; a coin
-- granted without a payment is worth nothing. The purchase a spend pays for
-- records the sum as its price_at_purchase, and a pack is no longer a sale
-- itself: its money is counted as its coins are spent, and counting the pack
-- as well would count it twice.

-- COLUMN: coin_spend_allocations amount
-- What the coins one spend drew from one grant were worth, in the currency of
-- the purchase the spend paid for: the coins times what the grant's pack
-- purchase was paid, over the coins it granted, rounded down. Zero for a
-- grant no payment made, a test purchase's, and a pack paid in another
-- currency, whose price cannot be added to the spend's. The amounts of a spend
-- add up to its purchase's price, and the amounts a refunded pack's grant
-- paid are what its refund takes back of the sales they made. Every spend
-- written before this column took no payment, as its purchase's price of 0
-- says, so it is 0 for those.
ALTER TABLE ONLY coin_spend_allocations
    ADD COLUMN amount integer DEFAULT 0 NOT NULL,
    ADD CONSTRAINT coin_spend_allocations_amount_check CHECK ((amount >= 0));

ALTER TABLE ONLY coin_spend_allocations
    ALTER COLUMN amount DROP DEFAULT;

-- VIEW: royalty_uncarried_refunds
-- Each purchase a statement has counted whose net, its price less its refund,
-- has fallen since, with the change still to be carried and the statement of
-- the month it was sold in. A purchase counts as a sale while it is neither
-- refunded in full nor lost to a dispute, the rule the month's own lines
-- apply, so a lost dispute is carried as a full refund is. A close carries the
-- rows of statements of earlier months than its own, and a preview shows the
-- same rows, so the two cannot disagree.
--
-- A purchase of a pack of coins is not a sale and has no row: what is
-- refunded of its money is carried by the purchases its coins paid for.
--
-- A row names no episode, since a purchase of a volume pays for several;
-- royalty_uncarried_episode_refunds divides it over them, starting from
-- counted_refunded_amount, what the statements have counted refunded of the
-- purchase so far.
--
-- Only a purchase with a refund or a lost dispute on it can have a row, which
-- is what keeps a close from summing every purchase the tenant ever sold.
CREATE OR REPLACE VIEW royalty_uncarried_refunds WITH (security_invoker = true) AS
SELECT
    p.tenant_id,
    p.id AS purchase_id,
    p.currency,
    rs.id AS statement_id,
    rs.period,
    (cur.sale_count - counted.sale_count)::integer AS sale_count,
    (cur.gross_amount - counted.gross_amount)::bigint AS gross_amount,
    (cur.refunded_amount - counted.refunded_amount)::bigint AS refunded_amount,
    counted.refunded_amount::bigint AS counted_refunded_amount
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
    AND p.coin_pack_id IS NULL
    AND counted.sale_count IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;
