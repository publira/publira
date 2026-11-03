ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_promotion_code_attempt_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN promotion_code_attempt_limit_per_day,
    DROP COLUMN promotion_code_attempt_limit_per_minute;

-- purchase_episode_parts loses a column, which CREATE OR REPLACE cannot do, so
-- it and the view that reads it are made again as they were.
DROP VIEW royalty_uncarried_episode_refunds;

DROP VIEW purchase_episode_parts;

CREATE VIEW purchase_episode_parts WITH (security_invoker = true) AS
SELECT vpe.tenant_id,
    vpe.purchase_id,
    vpe.episode_id,
    vpe.price,
    vp.purchased_at
FROM volume_purchase_episodes vpe
JOIN purchases vp ON vp.tenant_id = vpe.tenant_id
    AND vp.id = vpe.purchase_id
WHERE vpe.price > 0
UNION ALL
SELECT p.tenant_id,
    p.id AS purchase_id,
    p.episode_id,
    p.price_at_purchase AS price,
    p.purchased_at
FROM purchases p
WHERE p.episode_id IS NOT NULL
UNION ALL
SELECT p.tenant_id,
    p.id AS purchase_id,
    sbe.episode_id,
    part.price,
    p.purchased_at
FROM purchases p
JOIN series_bundle_episodes sbe ON sbe.tenant_id = p.tenant_id
    AND sbe.series_bundle_id = p.series_bundle_id
CROSS JOIN LATERAL (
    SELECT
        (sum(o.price) FILTER (WHERE (o."position", o.episode_id) <= (sbe."position", sbe.episode_id)))::bigint AS up_to,
        sum(o.price)::bigint AS total
    FROM series_bundle_episodes o
    WHERE o.tenant_id = sbe.tenant_id
        AND o.series_bundle_id = sbe.series_bundle_id
) running
CROSS JOIN LATERAL (
    SELECT
        (p.price_at_purchase::bigint * running.up_to / running.total
            - p.price_at_purchase::bigint * (running.up_to - sbe.price) / running.total)::integer AS price
) part
WHERE p.series_bundle_id IS NOT NULL
    AND running.total > 0
    AND part.price > 0;

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

CREATE VIEW royalty_uncarried_episode_refunds WITH (security_invoker = true) AS
SELECT
    u.tenant_id,
    u.purchase_id,
    pp.episode_id,
    u.currency,
    u.statement_id,
    u.period,
    u.sale_count,
    part.gross_amount,
    part.refunded_amount
FROM royalty_uncarried_refunds u
JOIN purchases p ON p.tenant_id = u.tenant_id
    AND p.id = u.purchase_id
JOIN purchase_episode_parts pp ON pp.tenant_id = u.tenant_id
    AND pp.purchase_id = u.purchase_id
CROSS JOIN LATERAL (
    SELECT
        (u.sale_count * pp.price)::bigint AS gross_amount,
        (
            episode_part_of_purchase_amount(u.counted_refunded_amount + u.refunded_amount, pp.price, p.price_at_purchase)
            - episode_part_of_purchase_amount(u.counted_refunded_amount, pp.price, p.price_at_purchase)
        )::bigint AS refunded_amount
) part
WHERE part.gross_amount - part.refunded_amount < 0;

DROP FUNCTION purchase_royalty_refunded_amount(bigint, integer, integer);

DROP FUNCTION purchase_royalty_basis(integer, integer);

ALTER TABLE ONLY volume_purchase_episodes
    DROP CONSTRAINT volume_purchase_episodes_royalty_price_check,
    DROP COLUMN royalty_price;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_tenant_promotion_code_id_fkey,
    DROP CONSTRAINT store_purchase_intents_promotion_code_check,
    DROP COLUMN promotion_code_id,
    DROP COLUMN list_price;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_promotion_code_id_fkey,
    DROP CONSTRAINT purchases_promotion_code_check,
    DROP CONSTRAINT purchases_list_price_check,
    DROP COLUMN promotion_code_id,
    DROP COLUMN list_price;

DROP TABLE promotion_code_redemptions;

DROP FUNCTION promotion_code_discounted_price(text, integer, integer);

DROP FUNCTION promotion_code_applies(text, uuid, uuid, uuid);

DROP TABLE promotion_codes;
