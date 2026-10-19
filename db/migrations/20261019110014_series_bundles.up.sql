-- Series bundles: every priced episode of a series a reader does not hold yet,
-- sold in one checkout at the series' bundle discount. The bundle is written
-- down when the checkout starts, since the notification that confirms the
-- payment has to know which episodes were paid for and a provider's metadata
-- holds far fewer of them than a series has. One purchase records the payment,
-- as for an episode or a volume, so a refund and a dispute still name exactly
-- one purchase.
--
-- The CHECK constraints and the foreign key added to existing tables are NOT
-- VALID, so this file takes its ACCESS EXCLUSIVE locks without scanning them;
-- the next migration validates them under a lock that lets reads and writes go
-- on.

-- COLUMN: series_listings bundle_discount_percent
-- What a bundle of the series takes off the sum of its episodes' prices, in
-- whole percent. NULL sells the bundle at that sum.
ALTER TABLE ONLY series_listings
    ADD COLUMN bundle_discount_percent integer,
    ADD CONSTRAINT series_listings_bundle_discount_percent_check CHECK (((bundle_discount_percent IS NULL) OR ((bundle_discount_percent >= 1) AND (bundle_discount_percent <= 99)))) NOT VALID;

-- TABLE: series_bundles
-- One reader's checkout of the rest of one series, at the terms it was started
-- with. price is what the checkout charges, in the minor unit of the tenant
-- currency: the sum of its episodes' prices less the discount. idempotency_key
-- is the key the checkout was started under, so a retried request finds the
-- bundle its provider checkout already names.
--
-- The expired_* columns record that the provider reported the checkout
-- expired, which moves the reader's next checkout of the same episodes onto a
-- new one, as expired_checkouts does for an episode.
CREATE TABLE series_bundles (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    user_id uuid,
    idempotency_key text NOT NULL,
    discount_percent integer,
    price integer NOT NULL,
    expired_provider text,
    expired_provider_checkout_id text,
    expired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT series_bundles_price_check CHECK ((price > 0)),
    CONSTRAINT series_bundles_discount_percent_check CHECK (((discount_percent IS NULL) OR ((discount_percent >= 1) AND (discount_percent <= 99)))),
    CONSTRAINT series_bundles_expired_check CHECK ((((expired_at IS NULL) = (expired_provider IS NULL)) AND ((expired_at IS NULL) = (expired_provider_checkout_id IS NULL))))
);

-- CONSTRAINT: series_bundles series_bundles_pkey
ALTER TABLE ONLY series_bundles
    ADD CONSTRAINT series_bundles_pkey PRIMARY KEY (id);

-- CONSTRAINT: series_bundles series_bundles_tenant_id_id_key
-- Lets the episodes and the purchases name the bundle together with its
-- tenant.
ALTER TABLE ONLY series_bundles
    ADD CONSTRAINT series_bundles_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: series_bundles series_bundles_tenant_idempotency_key_key
ALTER TABLE ONLY series_bundles
    ADD CONSTRAINT series_bundles_tenant_idempotency_key_key UNIQUE (tenant_id, idempotency_key);

-- FK CONSTRAINT: series_bundles series_bundles_tenant_id_fkey
ALTER TABLE ONLY series_bundles
    ADD CONSTRAINT series_bundles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_bundles series_bundles_tenant_series_id_fkey
ALTER TABLE ONLY series_bundles
    ADD CONSTRAINT series_bundles_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id);

-- FK CONSTRAINT: series_bundles series_bundles_tenant_user_id_fkey
-- A bundle someone paid for outlives its buyer's account, as the purchase of
-- it does.
ALTER TABLE ONLY series_bundles
    ADD CONSTRAINT series_bundles_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- INDEX: idx_series_bundles_tenant_series_id
-- Backs the composite foreign key to series.
CREATE INDEX idx_series_bundles_tenant_series_id ON series_bundles USING btree (tenant_id, series_id);

-- INDEX: idx_series_bundles_tenant_user_series_expired
-- The reader's latest expired checkout of a series' rest, and the composite
-- foreign key to users.
CREATE INDEX idx_series_bundles_tenant_user_series_expired ON series_bundles USING btree (tenant_id, user_id, series_id, expired_at DESC);

-- ROW SECURITY: series_bundles
ALTER TABLE series_bundles ENABLE ROW LEVEL SECURITY;

-- POLICY: series_bundles series_bundles_tenant_isolation
CREATE POLICY series_bundles_tenant_isolation ON series_bundles USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_bundle_episodes
-- The episodes a bundle sells, in the order the series lists them, each at the
-- terms of its permanent copy when the checkout started: list_price is the
-- episode's price, price the part of the bundle's price it accounts for once
-- the discount is spread over the bundle, and reading_period_hours how long
-- the purchase opens it, NULL for good.
CREATE TABLE series_bundle_episodes (
    tenant_id uuid NOT NULL,
    series_bundle_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    "position" integer NOT NULL,
    list_price integer NOT NULL,
    price integer NOT NULL,
    reading_period_hours integer,
    CONSTRAINT series_bundle_episodes_position_check CHECK (("position" >= 0)),
    CONSTRAINT series_bundle_episodes_list_price_check CHECK ((list_price > 0)),
    CONSTRAINT series_bundle_episodes_price_check CHECK (((price >= 0) AND (price <= list_price))),
    CONSTRAINT series_bundle_episodes_reading_period_hours_check CHECK (((reading_period_hours IS NULL) OR (reading_period_hours > 0)))
);

-- CONSTRAINT: series_bundle_episodes series_bundle_episodes_pkey
ALTER TABLE ONLY series_bundle_episodes
    ADD CONSTRAINT series_bundle_episodes_pkey PRIMARY KEY (series_bundle_id, episode_id);

-- FK CONSTRAINT: series_bundle_episodes series_bundle_episodes_tenant_id_fkey
ALTER TABLE ONLY series_bundle_episodes
    ADD CONSTRAINT series_bundle_episodes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_bundle_episodes series_bundle_episodes_tenant_bundle_id_fkey
ALTER TABLE ONLY series_bundle_episodes
    ADD CONSTRAINT series_bundle_episodes_tenant_bundle_id_fkey FOREIGN KEY (tenant_id, series_bundle_id) REFERENCES series_bundles(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_bundle_episodes series_bundle_episodes_tenant_episode_id_fkey
-- An episode in a bundle is not deleted out from under its buyers, as one in a
-- volume is not (volume_episodes_tenant_episode_id_fkey). NO ACTION rather
-- than RESTRICT, so a tenant deleted as a whole takes both rows in the one
-- statement.
ALTER TABLE ONLY series_bundle_episodes
    ADD CONSTRAINT series_bundle_episodes_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id);

-- INDEX: idx_series_bundle_episodes_tenant_bundle_position
-- A bundle's episodes in its own order, and the composite foreign key to it.
CREATE INDEX idx_series_bundle_episodes_tenant_bundle_position ON series_bundle_episodes USING btree (tenant_id, series_bundle_id, "position");

-- INDEX: idx_series_bundle_episodes_tenant_episode_id
-- Backs the composite foreign key to episodes.
CREATE INDEX idx_series_bundle_episodes_tenant_episode_id ON series_bundle_episodes USING btree (tenant_id, episode_id);

-- ROW SECURITY: series_bundle_episodes
ALTER TABLE series_bundle_episodes ENABLE ROW LEVEL SECURITY;

-- POLICY: series_bundle_episodes series_bundle_episodes_tenant_isolation
CREATE POLICY series_bundle_episodes_tenant_isolation ON series_bundle_episodes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: purchases series_bundle_id
-- What a purchase bought is now exactly one of an episode, a volume, and a
-- series bundle. A bundle is the permanent copy of each of its episodes and is
-- sold by no store, as a volume is.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_item_check,
    ADD COLUMN series_bundle_id uuid,
    ADD CONSTRAINT purchases_item_check CHECK (((num_nonnulls(episode_id, volume_id, series_bundle_id) = 1) AND ((episode_id IS NOT NULL) OR ((kind = 'purchase'::text) AND (store IS NULL))))) NOT VALID,
    ADD CONSTRAINT purchases_tenant_series_bundle_id_fkey FOREIGN KEY (tenant_id, series_bundle_id) REFERENCES series_bundles(tenant_id, id) NOT VALID;

-- VIEW: episode_content_grants
-- A purchase of a bundle grants each episode it holds as a purchase of that
-- episode would: for good, or for the reading period the episode's permanent
-- copy had when the checkout started, counted from the purchase.
CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
WHERE p.episode_id IS NOT NULL
    AND p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    ve.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN volume_episodes ve ON ve.tenant_id = p.tenant_id
    AND ve.volume_id = p.volume_id
WHERE p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    sbe.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN series_bundle_episodes sbe ON sbe.tenant_id = p.tenant_id
    AND sbe.series_bundle_id = p.series_bundle_id
WHERE p.revoked_at IS NULL
    AND (
        sbe.reading_period_hours IS NULL
        OR p.purchased_at + make_interval(hours => sbe.reading_period_hours) > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id;
