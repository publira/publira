-- CREATE OR REPLACE VIEW cannot take a column away, so the view is dropped and
-- created as it was, and so is the view that reads it.
DROP VIEW IF EXISTS royalty_uncarried_episode_refunds;
DROP VIEW IF EXISTS purchase_episode_parts;

CREATE VIEW purchase_episode_parts WITH (security_invoker = true) AS
SELECT vpe.tenant_id,
    vpe.purchase_id,
    vpe.episode_id,
    vpe.price
FROM volume_purchase_episodes vpe
WHERE vpe.price > 0
UNION ALL
SELECT p.tenant_id,
    p.id AS purchase_id,
    p.episode_id,
    p.price_at_purchase AS price
FROM purchases p
WHERE p.episode_id IS NOT NULL
UNION ALL
SELECT p.tenant_id,
    p.id AS purchase_id,
    sbe.episode_id,
    part.price
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
