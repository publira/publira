-- VIEW: purchase_episode_parts
CREATE OR REPLACE VIEW purchase_episode_parts WITH (security_invoker = true) AS
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
WHERE p.episode_id IS NOT NULL;
