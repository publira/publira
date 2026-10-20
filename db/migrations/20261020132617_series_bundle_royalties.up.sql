-- Royalties on the sale of the rest of a series. A purchase of a series bundle
-- names no episode, but the bundle wrote down, when its checkout started, the
-- part of its price each of its episodes accounts for, so a royalty statement
-- credits each part as it credits the sale of that episode on its own.

-- VIEW: purchase_episode_parts
-- Each episode a purchase paid for, with the part of its price_at_purchase
-- that episode accounts for: all of it for a purchase of the episode itself,
-- the part written down for a purchase of a volume, and for a purchase of a
-- series bundle the part series_bundle_episodes recorded for it. A royalty
-- statement credits a sale through this, so the sale of a volume or of the
-- rest of a series pays the creators of each episode in it as a sale of that
-- episode would.
--
-- A bundle's parts add up to its price, and a promotion code can make what the
-- reader paid less than that, so the bundle's parts are spread over
-- price_at_purchase in their own proportions: each is what the running total
-- of the parts up to and including it comes to of the payment less what the
-- total before it came to, each rounded down, so that they add up to the
-- payment exactly, as a volume's do. A payment of the bundle's price leaves
-- every part as it was recorded. The running total is read for each row on its
-- own, so a statement reading one purchase's parts reads that purchase's
-- episodes only.
--
-- An episode of a volume or a bundle that accounts for none of it, a free one
-- or one a deep discount left nothing to, is no part of the sale: a line
-- crediting a sale with nothing would have nothing for a refund to take back,
-- and would go on counting the sale after it was refunded.
--
-- The volume's rows come first because purchases.episode_id may be NULL, and
-- sqlc reads whether a column of a UNION may be NULL from its first branch.
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
