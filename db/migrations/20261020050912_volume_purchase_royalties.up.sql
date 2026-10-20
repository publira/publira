-- Royalties on the sale of a volume. A purchase of a volume names no episode,
-- so the part of what the reader paid that each of its episodes accounts for
-- is written down with the purchase, and a royalty statement credits each part
-- as it credits the sale of that episode on its own.

-- CONSTRAINT: purchases purchases_tenant_id_id_key
-- The index the previous migration built concurrently, attached as the target
-- of a reference that names a purchase with its tenant. Attaching an index
-- that already exists is a change to the catalog only, so the lock this takes
-- is brief.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_id_id_key UNIQUE USING INDEX purchases_tenant_id_id_key;

-- TABLE: volume_purchase_episodes
-- The episodes a purchase of a volume paid for, as the volume held them when
-- the purchase was recorded, in the volume's order. list_price is the
-- episode's own price at that moment, and price the part of the purchase's
-- price_at_purchase it accounts for: that amount spread over the episodes in
-- proportion to their prices, or evenly when none of them has one, and
-- rounded so that the parts add up to it exactly.
--
-- The rows are written once, with the purchase, so an editor who reprices an
-- episode or changes what the volume holds afterwards moves nothing a
-- statement credits for the sale.
CREATE TABLE volume_purchase_episodes (
    tenant_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    "position" integer NOT NULL,
    list_price integer NOT NULL,
    price integer NOT NULL,
    CONSTRAINT volume_purchase_episodes_position_check CHECK (("position" >= 0)),
    CONSTRAINT volume_purchase_episodes_list_price_check CHECK ((list_price >= 0)),
    CONSTRAINT volume_purchase_episodes_price_check CHECK ((price >= 0))
);

-- CONSTRAINT: volume_purchase_episodes volume_purchase_episodes_pkey
-- Led by the purchase, which is how a statement reads the parts of a sale, and
-- what the composite foreign key to purchases looks a purchase's rows up by.
ALTER TABLE ONLY volume_purchase_episodes
    ADD CONSTRAINT volume_purchase_episodes_pkey PRIMARY KEY (purchase_id, episode_id);

-- FK CONSTRAINT: volume_purchase_episodes volume_purchase_episodes_tenant_id_fkey
ALTER TABLE ONLY volume_purchase_episodes
    ADD CONSTRAINT volume_purchase_episodes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_purchase_episodes volume_purchase_episodes_tenant_purchase_id_fkey
ALTER TABLE ONLY volume_purchase_episodes
    ADD CONSTRAINT volume_purchase_episodes_tenant_purchase_id_fkey FOREIGN KEY (tenant_id, purchase_id) REFERENCES purchases(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_purchase_episodes volume_purchase_episodes_tenant_episode_id_fkey
-- An episode a sale was credited to is not deleted out from under the sale, as
-- one in a volume is not (volume_episodes_tenant_episode_id_fkey). NO ACTION
-- rather than RESTRICT, so a tenant deleted as a whole takes both rows in the
-- one statement.
ALTER TABLE ONLY volume_purchase_episodes
    ADD CONSTRAINT volume_purchase_episodes_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id);

-- INDEX: idx_volume_purchase_episodes_tenant_episode_id
-- Backs the composite foreign key to episodes.
CREATE INDEX idx_volume_purchase_episodes_tenant_episode_id ON volume_purchase_episodes USING btree (tenant_id, episode_id);

-- ROW SECURITY: volume_purchase_episodes
ALTER TABLE volume_purchase_episodes ENABLE ROW LEVEL SECURITY;

-- POLICY: volume_purchase_episodes volume_purchase_episodes_tenant_isolation
CREATE POLICY volume_purchase_episodes_tenant_isolation ON volume_purchase_episodes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- VIEW: purchase_episode_parts
-- Each episode a purchase paid for, with the part of its price_at_purchase
-- that episode accounts for: all of it for a purchase of the episode itself,
-- and the part written down for a purchase of a volume. A royalty statement
-- credits a sale through this, so the sale of a volume pays the creators of
-- each episode in it as a sale of that episode would.
--
-- An episode of a volume that accounts for none of it, a free one, is no part
-- of the sale: a line crediting a sale with nothing would have nothing for a
-- refund to take back, and would go on counting the sale after it was refunded.
--
-- The volume's rows come first because purchases.episode_id may be NULL, and
-- sqlc reads whether a column of a UNION may be NULL from its first branch.
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
WHERE p.episode_id IS NOT NULL;

-- FUNCTION: episode_part_of_purchase_amount
-- The part of an amount of a purchase, a refund of it, that falls on an
-- episode accounting for part of the purchase's price: the same proportion of
-- the amount, rounded down. Rounded on its own rather than so that the parts
-- add up to the amount, because a refund's total can grow and shrink again,
-- and only a rule that gives each episode a part that never falls as the total
-- grows lets a later statement carry the change of each part on its own. The
-- parts of a refund therefore fall short of it by less than one minor unit per
-- episode. A purchase of one episode takes the whole amount.
--
-- The lines of a month's own sales and the adjustments of a closed month's
-- both divide a refund this way, so the two cannot disagree.
--
-- The amount is at most the price, so the part is at most the episode's part
-- of the price and fits the integer the amounts of a purchase are kept in.
CREATE FUNCTION episode_part_of_purchase_amount(amount bigint, part integer, price integer) RETURNS integer
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN episode_part_of_purchase_amount.price > 0
            THEN (episode_part_of_purchase_amount.amount * episode_part_of_purchase_amount.part / episode_part_of_purchase_amount.price)::integer
        ELSE 0
    END
$$;

-- VIEW: royalty_uncarried_refunds
-- Each purchase a statement has counted whose net, its price less its refund,
-- has fallen since, with the change still to be carried and the statement of
-- the month it was sold in. A purchase counts as a sale while it is neither
-- refunded in full nor lost to a dispute, the rule the month's own lines
-- apply, so a lost dispute is carried as a full refund is. A close carries the
-- rows of statements of earlier months than its own, and a preview shows the
-- same rows, so the two cannot disagree.
--
-- A row names no episode, since a purchase of a volume pays for several;
-- royalty_uncarried_episode_refunds divides it over them, starting from
-- counted_refunded_amount, what the statements have counted refunded of the
-- purchase so far.
--
-- Only a purchase with a refund or a lost dispute on it can have a row, which
-- is what keeps a close from summing every purchase the tenant ever sold.
DROP VIEW royalty_uncarried_refunds;
CREATE VIEW royalty_uncarried_refunds WITH (security_invoker = true) AS
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
    AND counted.sale_count IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;

-- VIEW: royalty_uncarried_episode_refunds
-- royalty_uncarried_refunds spread over the episodes each purchase paid for,
-- which is what an adjustment line takes back from the closed line of each
-- episode. A purchase counts a sale of every episode it paid for, so its
-- change of sale_count is each episode's, and its change of price each
-- episode's part of the price. An episode's change of refund is its part of
-- the refund now less its part of the refund the statements have counted,
-- each divided by episode_part_of_purchase_amount, which is how the lines of
-- the month the purchase was sold in divided it.
--
-- An episode whose net that leaves unchanged, one that takes none of a small
-- refund's growth, has no row, as a purchase whose net has not fallen has none
-- in royalty_uncarried_refunds. Its part of the refund is still counted: the
-- next change is measured from the purchase's whole refund.
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
