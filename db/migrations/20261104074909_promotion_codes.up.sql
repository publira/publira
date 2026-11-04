-- TABLE: promotion_codes
-- A code a tenant hands out, which the server applies to a checkout or a store
-- purchase before any payment provider or store is reached, so the provider
-- charges the discounted price without knowing why. A code is no stored value:
-- it has no balance, and what it takes off is worked out again on every
-- purchase.
--
-- code is matched without regard to case, so it is unique per tenant in upper
-- case among the codes not deleted: a paused code keeps its name and can be
-- resumed, and a deleted one gives its name up. A code is deleted softly,
-- because the purchases it discounted name it.
--
-- discount_kind is 'percent', discount_value then a whole percentage from 1 to
-- 100, or 'amount', discount_value then an amount in the minor unit of the
-- tenant's currency. Either is taken off the price in force and rounded down,
-- and never below zero.
--
-- target_kind is what the code applies to: 'catalog' (every episode and volume,
-- target_id NULL), 'label', 'series', 'volume', or 'episode', target_id then
-- naming it. target_id has no foreign key, since it names a row of one of four
-- tables; a code whose target is gone applies to nothing.
--
-- starts_at and ends_at bound when the code works, NULL for no bound;
-- max_redemptions and max_redemptions_per_reader bound how many purchases it
-- may discount in all and for one reader, NULL for no limit. These, and
-- paused_at, are what a tenant can change after creating the code; the code,
-- its discount, and its target are fixed, as a campaign price is.
CREATE TABLE promotion_codes (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    discount_kind text NOT NULL,
    discount_value integer NOT NULL,
    target_kind text NOT NULL,
    target_id uuid,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    max_redemptions integer,
    max_redemptions_per_reader integer,
    paused_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotion_codes_code_check CHECK ((code ~ '^[A-Za-z0-9]{1,32}$'::text)),
    CONSTRAINT promotion_codes_discount_check CHECK ((((discount_kind = 'percent'::text) AND (discount_value >= 1) AND (discount_value <= 100)) OR ((discount_kind = 'amount'::text) AND (discount_value >= 1)))),
    CONSTRAINT promotion_codes_target_check CHECK (((target_kind = ANY (ARRAY['catalog'::text, 'label'::text, 'series'::text, 'volume'::text, 'episode'::text])) AND ((target_kind = 'catalog'::text) = (target_id IS NULL)))),
    CONSTRAINT promotion_codes_window_check CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (starts_at < ends_at))),
    CONSTRAINT promotion_codes_max_redemptions_check CHECK (((max_redemptions IS NULL) OR (max_redemptions >= 1))),
    CONSTRAINT promotion_codes_max_redemptions_per_reader_check CHECK (((max_redemptions_per_reader IS NULL) OR (max_redemptions_per_reader >= 1)))
);

-- CONSTRAINT: promotion_codes promotion_codes_pkey
ALTER TABLE ONLY promotion_codes
    ADD CONSTRAINT promotion_codes_pkey PRIMARY KEY (id);

-- CONSTRAINT: promotion_codes promotion_codes_tenant_id_id_key
-- The target of the composite foreign keys that keep a purchase, an intent,
-- and a redemption from naming another tenant's code.
ALTER TABLE ONLY promotion_codes
    ADD CONSTRAINT promotion_codes_tenant_id_id_key UNIQUE (tenant_id, id);

-- INDEX: promotion_codes idx_promotion_codes_tenant_code
-- The lookup a reader's code is matched by, and what keeps two live codes of
-- a tenant from sharing a name in any case.
CREATE UNIQUE INDEX idx_promotion_codes_tenant_code ON promotion_codes USING btree (tenant_id, upper(code)) WHERE (deleted_at IS NULL);

-- INDEX: promotion_codes idx_promotion_codes_tenant_created_at
-- The keyset of ListPromotionCodes, newest first.
CREATE INDEX idx_promotion_codes_tenant_created_at ON promotion_codes USING btree (tenant_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL);

-- FK CONSTRAINT: promotion_codes promotion_codes_tenant_id_fkey
ALTER TABLE ONLY promotion_codes
    ADD CONSTRAINT promotion_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: promotion_codes promotion_codes_tenant_created_by_user_id_fkey
-- SET NULL lists created_by_user_id so the reference can stay composite, as
-- episode_free_windows' does; audit_logs keeps who created the code.
ALTER TABLE ONLY promotion_codes
    ADD CONSTRAINT promotion_codes_tenant_created_by_user_id_fkey FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by_user_id);

-- ROW SECURITY: promotion_codes
ALTER TABLE promotion_codes ENABLE ROW LEVEL SECURITY;

-- POLICY: promotion_codes promotion_codes_tenant_isolation
CREATE POLICY promotion_codes_tenant_isolation ON promotion_codes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: promotion_code_applies
-- Whether a code with the target target_kind and target_id names applies to a
-- purchase of the episode episode_id or of the volume volume_id, one of which
-- is NULL: the whole catalog, the episode or the volume itself, or the series
-- or the label it belongs to. A code on a volume applies to the volume's sale
-- alone, and a code on an episode to that episode's alone, never to a volume
-- that holds it. It reads under the caller's row-level security, so it finds
-- no episode, volume, or series of another tenant, and it answers false, never
-- NULL, for a sale that is not of the kind the target names.
CREATE FUNCTION promotion_code_applies(target_kind text, target_id uuid, episode_id uuid, volume_id uuid) RETURNS boolean
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT COALESCE(CASE promotion_code_applies.target_kind
        WHEN 'catalog' THEN TRUE
        WHEN 'episode' THEN promotion_code_applies.target_id = promotion_code_applies.episode_id
        WHEN 'volume' THEN promotion_code_applies.target_id = promotion_code_applies.volume_id
        WHEN 'series' THEN EXISTS (
            SELECT 1
            FROM public.episodes e
            WHERE e.id = promotion_code_applies.episode_id
                AND e.series_id = promotion_code_applies.target_id
        ) OR EXISTS (
            SELECT 1
            FROM public.volumes v
            WHERE v.id = promotion_code_applies.volume_id
                AND v.series_id = promotion_code_applies.target_id
        )
        WHEN 'label' THEN EXISTS (
            SELECT 1
            FROM public.episodes e
                JOIN public.series s ON s.tenant_id = e.tenant_id
                AND s.id = e.series_id
            WHERE e.id = promotion_code_applies.episode_id
                AND s.label_id = promotion_code_applies.target_id
        ) OR EXISTS (
            SELECT 1
            FROM public.volumes v
                JOIN public.series s ON s.tenant_id = v.tenant_id
                AND s.id = v.series_id
            WHERE v.id = promotion_code_applies.volume_id
                AND s.label_id = promotion_code_applies.target_id
        )
        ELSE FALSE
    END, FALSE)
$$;

-- FUNCTION: promotion_code_discounted_price
-- What a price comes to once a code's discount is taken off it: the percentage
-- of it, rounded down, or the amount, and never below zero. The server applies
-- a code with the same arithmetic in Go (internal/promotioncode), and
-- ListTenantStoreProductPrices with this, so the store product the app is
-- asked to buy is the one the console listed.
CREATE FUNCTION promotion_code_discounted_price(discount_kind text, discount_value integer, price integer) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
    SELECT GREATEST(
        0,
        promotion_code_discounted_price.price - CASE promotion_code_discounted_price.discount_kind
            WHEN 'percent' THEN (promotion_code_discounted_price.price::bigint * promotion_code_discounted_price.discount_value / 100)::integer
            ELSE promotion_code_discounted_price.discount_value
        END
    )
$$;

-- TABLE: promotion_code_redemptions
-- One purchase a code discounted, written with the purchase rather than when
-- its checkout started, so a checkout the reader abandons spends none of the
-- code's limits. The limits are checked when a checkout starts, so checkouts
-- in flight when one is reached may each pass it.
--
-- user_id is the reader who bought, kept NULL once their account is deleted,
-- as the purchase keeps it.
CREATE TABLE promotion_code_redemptions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    promotion_code_id uuid NOT NULL,
    user_id uuid,
    purchase_id uuid NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: promotion_code_redemptions promotion_code_redemptions_pkey
ALTER TABLE ONLY promotion_code_redemptions
    ADD CONSTRAINT promotion_code_redemptions_pkey PRIMARY KEY (id);

-- CONSTRAINT: promotion_code_redemptions promotion_code_redemptions_purchase_id_key
-- A purchase redeems one code once, so a redelivered notification writes
-- nothing twice.
ALTER TABLE ONLY promotion_code_redemptions
    ADD CONSTRAINT promotion_code_redemptions_purchase_id_key UNIQUE (purchase_id);

-- INDEX: promotion_code_redemptions idx_promotion_code_redemptions_code_redeemed_at
-- The keyset of ListPromotionCodeRedemptions, newest first, and the count a
-- checkout checks the code's total limit against.
CREATE INDEX idx_promotion_code_redemptions_code_redeemed_at ON promotion_code_redemptions USING btree (tenant_id, promotion_code_id, redeemed_at DESC, id DESC);

-- INDEX: promotion_code_redemptions idx_promotion_code_redemptions_code_user
-- The count a checkout checks the code's limit for one reader against.
CREATE INDEX idx_promotion_code_redemptions_code_user ON promotion_code_redemptions USING btree (tenant_id, promotion_code_id, user_id);

-- FK CONSTRAINT: promotion_code_redemptions promotion_code_redemptions_tenant_id_fkey
ALTER TABLE ONLY promotion_code_redemptions
    ADD CONSTRAINT promotion_code_redemptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: promotion_code_redemptions promotion_code_redemptions_tenant_promotion_code_id_fkey
ALTER TABLE ONLY promotion_code_redemptions
    ADD CONSTRAINT promotion_code_redemptions_tenant_promotion_code_id_fkey FOREIGN KEY (tenant_id, promotion_code_id) REFERENCES promotion_codes(tenant_id, id);

-- FK CONSTRAINT: promotion_code_redemptions promotion_code_redemptions_tenant_purchase_id_fkey
ALTER TABLE ONLY promotion_code_redemptions
    ADD CONSTRAINT promotion_code_redemptions_tenant_purchase_id_fkey FOREIGN KEY (tenant_id, purchase_id) REFERENCES purchases(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: promotion_code_redemptions promotion_code_redemptions_tenant_user_id_fkey
ALTER TABLE ONLY promotion_code_redemptions
    ADD CONSTRAINT promotion_code_redemptions_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- ROW SECURITY: promotion_code_redemptions
ALTER TABLE promotion_code_redemptions ENABLE ROW LEVEL SECURITY;

-- POLICY: promotion_code_redemptions promotion_code_redemptions_tenant_isolation
CREATE POLICY promotion_code_redemptions_tenant_isolation ON promotion_code_redemptions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: purchases list_price
-- COLUMN: purchases promotion_code_id
-- list_price is the price before a promotion code took its discount off, the
-- one the tenant's own code (promotion_code_id) or a code entered on Stripe's
-- checkout page (provider_promotion_code_id) did; price_at_purchase stays what
-- the reader paid, which is what a refund of the payment returns. NULL is a
-- purchase no code discounted, whose list price is what was paid, and every
-- purchase recorded before this column. The discount is list_price less
-- price_at_purchase. A purchase names at most one of the two codes.
--
-- Both allow NULL, so the previous release's inserts, which name neither,
-- keep working. The checks and the foreign key are added NOT VALID and
-- validated by the next migration, which takes a lighter lock.
ALTER TABLE ONLY purchases
    ADD COLUMN list_price integer,
    ADD COLUMN promotion_code_id uuid;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_list_price_check CHECK (((list_price IS NULL) OR (list_price >= price_at_purchase))) NOT VALID;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_promotion_code_check CHECK (((num_nonnulls(promotion_code_id, provider_promotion_code_id) <= 1) AND ((promotion_code_id IS NULL) OR (list_price IS NOT NULL)))) NOT VALID;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_promotion_code_id_fkey FOREIGN KEY (tenant_id, promotion_code_id) REFERENCES promotion_codes(tenant_id, id) NOT VALID;

-- COLUMN: store_purchase_intents list_price
-- COLUMN: store_purchase_intents promotion_code_id
-- The code an intent was opened with and the price before its discount, which
-- the purchase the intent becomes records; price stays what the store
-- charges. NULL on an intent no code discounted, and on every intent the
-- previous release opens.
ALTER TABLE ONLY store_purchase_intents
    ADD COLUMN list_price integer,
    ADD COLUMN promotion_code_id uuid;

ALTER TABLE ONLY store_purchase_intents
    ADD CONSTRAINT store_purchase_intents_promotion_code_check CHECK (((promotion_code_id IS NULL) = (list_price IS NULL)) AND ((list_price IS NULL) OR (list_price >= price))) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    ADD CONSTRAINT store_purchase_intents_tenant_promotion_code_id_fkey FOREIGN KEY (tenant_id, promotion_code_id) REFERENCES promotion_codes(tenant_id, id) NOT VALID;

-- COLUMN: volume_purchase_episodes royalty_price
-- The part of the volume's royalty basis, purchase_royalty_basis of its
-- purchase, each episode accounts for, spread as price spreads what the reader
-- paid. NULL on every row written before this column and by the previous
-- release, whose purchases were paid their basis, so price stands in for it.
ALTER TABLE ONLY volume_purchase_episodes
    ADD COLUMN royalty_price integer,
    ADD CONSTRAINT volume_purchase_episodes_royalty_price_check CHECK (((royalty_price IS NULL) OR (royalty_price >= 0)));

-- FUNCTION: purchase_royalty_basis
-- What a royalty statement credits a purchase at: its list price, the one
-- before a promotion code took its discount off, and what was paid for a
-- purchase no code discounted. The tenant chose the promotion, so the tenant
-- bears it, and an Author is paid as if the sale had been made at its price.
CREATE FUNCTION purchase_royalty_basis(list_price integer, price_at_purchase integer) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
    SELECT COALESCE(purchase_royalty_basis.list_price, purchase_royalty_basis.price_at_purchase)
$$;

-- FUNCTION: purchase_royalty_refunded_amount
-- What a refund of amount, of what was paid, takes back of the purchase's
-- royalty basis: the same share of it, rounded down and never more than the
-- basis. A purchase no code discounted has the payment for its basis, and its
-- refund is taken back as it is. One that took no payment has nothing a
-- refund could return.
CREATE FUNCTION purchase_royalty_refunded_amount(amount bigint, list_price integer, price_at_purchase integer) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
    SELECT CASE
        WHEN purchase_royalty_refunded_amount.list_price IS NULL
            THEN purchase_royalty_refunded_amount.amount::integer
        WHEN purchase_royalty_refunded_amount.price_at_purchase <= 0
            THEN 0
        ELSE LEAST(
            purchase_royalty_refunded_amount.list_price::bigint,
            purchase_royalty_refunded_amount.amount * purchase_royalty_refunded_amount.list_price / purchase_royalty_refunded_amount.price_at_purchase
        )::integer
    END
$$;

-- VIEW: purchase_episode_parts
-- Each episode a purchase paid for, with the part of its price_at_purchase
-- that episode accounts for (price) and the part of its royalty basis
-- (royalty_price), the two apart only on a purchase a promotion code
-- discounted: all of each for a purchase of the episode itself, the parts
-- written down for a purchase of a volume, and for a purchase of a series
-- bundle the part series_bundle_episodes recorded for it. A royalty statement
-- credits a sale through royalty_price, so the sale of a volume or of the rest
-- of a series pays the creators of each episode in it as a sale of that
-- episode would, and the reports of revenue read price, what was paid.
--
-- A bundle's parts add up to its price, and a promotion code can make what the
-- reader paid less than that, so the bundle's parts are spread over
-- price_at_purchase in their own proportions: each is what the running total
-- of the parts up to and including it comes to of the payment less what the
-- total before it came to, each rounded down, so that they add up to the
-- payment exactly, as a volume's do. A payment of the bundle's price leaves
-- every part as it was recorded. The running total is read for each row on its
-- own, so a statement reading one purchase's parts reads that purchase's
-- episodes only. No code of the tenant's applies to a bundle, so its two parts
-- are the same.
--
-- An episode of a volume or a bundle that accounts for none of either, a free
-- one or one a deep discount left nothing to, is no part of the sale: a line
-- crediting a sale with nothing would have nothing for a refund to take back,
-- and would go on counting the sale after it was refunded. An episode of a
-- volume a code took the whole price off still accounts for its part of the
-- royalty basis.
--
-- purchased_at is the purchase's own, carried so that a report over a period
-- of sales narrows every branch to that period by itself. A join on
-- purchase_id alone is not pushed into the branches of a union, so a reader
-- that joins the purchases of a period to this would otherwise read the parts
-- of every purchase the tenant ever made.
--
-- The volume's rows come first because purchases.episode_id may be NULL, and
-- sqlc reads whether a column of a UNION may be NULL from its first branch.
CREATE OR REPLACE VIEW purchase_episode_parts WITH (security_invoker = true) AS
SELECT vpe.tenant_id,
    vpe.purchase_id,
    vpe.episode_id,
    vpe.price,
    vp.purchased_at,
    COALESCE(vpe.royalty_price, vpe.price) AS royalty_price
FROM volume_purchase_episodes vpe
JOIN purchases vp ON vp.tenant_id = vpe.tenant_id
    AND vp.id = vpe.purchase_id
WHERE vpe.price > 0
    OR vpe.royalty_price > 0
UNION ALL
SELECT p.tenant_id,
    p.id AS purchase_id,
    p.episode_id,
    p.price_at_purchase AS price,
    p.purchased_at,
    purchase_royalty_basis(p.list_price, p.price_at_purchase) AS royalty_price
FROM purchases p
WHERE p.episode_id IS NOT NULL
UNION ALL
SELECT p.tenant_id,
    p.id AS purchase_id,
    sbe.episode_id,
    part.price,
    p.purchased_at,
    part.price AS royalty_price
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

-- VIEW: royalty_uncarried_refunds
-- Each purchase a statement has counted whose net, its royalty basis less the
-- part of it its refund takes back, has fallen since, with the change still
-- to be carried and the statement of the month it was sold in. A purchase
-- counts as a sale while it is neither refunded in full nor lost to a dispute,
-- the rule the month's own lines apply, so a lost dispute is carried as a full
-- refund is. A close carries the rows of statements of earlier months than its
-- own, and a preview shows the same rows, so the two cannot disagree.
--
-- The basis and the refund are purchase_royalty_basis and
-- purchase_royalty_refunded_amount, as the month's own lines count them, so a
-- refund of a purchase a promotion code discounted takes back the share of
-- the line the reader was refunded of what they paid.
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
        CASE WHEN p.refunded_at IS NULL AND p.dispute_lost_at IS NULL THEN purchase_royalty_basis(p.list_price, p.price_at_purchase) ELSE 0 END AS gross_amount,
        CASE WHEN p.refunded_at IS NULL AND p.dispute_lost_at IS NULL THEN purchase_royalty_refunded_amount(COALESCE(p.refunded_amount, 0), p.list_price, p.price_at_purchase) ELSE 0 END AS refunded_amount
) cur
WHERE (p.refunded_amount IS NOT NULL OR p.dispute_lost_at IS NOT NULL)
    AND p.coin_pack_id IS NULL
    AND counted.sale_count IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;

-- VIEW: royalty_uncarried_episode_refunds
-- royalty_uncarried_refunds spread over the episodes each purchase paid for,
-- which is what an adjustment line takes back from the closed line of each
-- episode. A purchase counts a sale of every episode it paid for, so its
-- change of sale_count is each episode's, and its change of royalty basis
-- each episode's part of it. An episode's change of refund is its part of the
-- refund now less its part of the refund the statements have counted, each
-- divided by episode_part_of_purchase_amount over the purchase's royalty
-- basis, which is how the lines of the month the purchase was sold in divided
-- it.
--
-- An episode whose net that leaves unchanged, one that takes none of a small
-- refund's growth, has no row, as a purchase whose net has not fallen has none
-- in royalty_uncarried_refunds. Its part of the refund is still counted: the
-- next change is measured from the purchase's whole refund.
CREATE OR REPLACE VIEW royalty_uncarried_episode_refunds WITH (security_invoker = true) AS
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
        (u.sale_count * pp.royalty_price)::bigint AS gross_amount,
        (
            episode_part_of_purchase_amount(u.counted_refunded_amount + u.refunded_amount, pp.royalty_price, purchase_royalty_basis(p.list_price, p.price_at_purchase))
            - episode_part_of_purchase_amount(u.counted_refunded_amount, pp.royalty_price, purchase_royalty_basis(p.list_price, p.price_at_purchase))
        )::bigint AS refunded_amount
) part
WHERE part.gross_amount - part.refunded_amount < 0;

-- COLUMN: platform_policy_config promotion_code_attempt_limit_per_minute
-- COLUMN: platform_policy_config promotion_code_attempt_limit_per_day
-- How often one reader may have a promotion code looked up, by
-- PurchaseService.PreviewPromotionCode and by every checkout or store purchase
-- started with a code. A code is a secret the tenant handed out, so what this
-- bounds is how fast one account can guess at them. These keep their defaults:
-- the previous release's insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN promotion_code_attempt_limit_per_minute integer DEFAULT 5 NOT NULL,
    ADD COLUMN promotion_code_attempt_limit_per_day integer DEFAULT 30 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_promotion_code_attempt_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_promotion_code_attempt_limit_check CHECK (((promotion_code_attempt_limit_per_minute >= 1) AND (promotion_code_attempt_limit_per_day >= promotion_code_attempt_limit_per_minute)));
