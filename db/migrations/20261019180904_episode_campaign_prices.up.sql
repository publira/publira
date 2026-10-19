-- Scheduled campaign prices: a period during which an episode's permanent copy
-- sells for less, without changing episode_listings.price. The listing's price
-- is what the episode costs again once the campaign ends, so a sale never has
-- to be undone by restoring a number an editor has to remember, as with a free
-- window.

-- TABLE: episode_campaign_prices
-- One row is one campaign period on one episode, with the price the permanent
-- copy sells for during it, in the minor unit of the tenant currency as
-- episode_listings.price is. Both ends are absolute instants, picked in the
-- tenant's own time zone by the console, as a free window's are.
--
-- The row is deleted rather than cancelled, for the reason a free window's is:
-- audit_logs keeps who scheduled and who removed one, and a purchase keeps
-- what it was charged.
CREATE TABLE episode_campaign_prices (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    episode_id uuid NOT NULL,
    price integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    -- When the apply-campaign-prices batch dropped the public site caches for
    -- each end of the campaign. NULL means that boundary has not been applied
    -- yet, so a batch that was down over a boundary still catches up on its
    -- next pass instead of leaving an ended campaign's price served from cache.
    start_revalidated_at timestamp with time zone,
    end_revalidated_at timestamp with time zone,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- A campaign at no price would be a free window under another name, and
    -- free windows are what open an episode to everyone.
    CONSTRAINT episode_campaign_prices_price_check CHECK ((price > 0)),
    -- Half-open [starts_at, ends_at), so one campaign may begin at the instant
    -- another ends.
    CONSTRAINT episode_campaign_prices_period_check CHECK ((ends_at > starts_at))
);

-- CONSTRAINT: episode_campaign_prices episode_campaign_prices_pkey
ALTER TABLE ONLY episode_campaign_prices
    ADD CONSTRAINT episode_campaign_prices_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_campaign_prices episode_campaign_prices_tenant_public_id_key
ALTER TABLE ONLY episode_campaign_prices
    ADD CONSTRAINT episode_campaign_prices_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- CONSTRAINT: episode_campaign_prices episode_campaign_prices_no_overlap
-- At most one campaign covers any instant of an episode, so a checkout never
-- has two campaign prices to choose between. btree_gist, which the free
-- windows migration installs, supplies the uuid equality this needs.
ALTER TABLE ONLY episode_campaign_prices
    ADD CONSTRAINT episode_campaign_prices_no_overlap EXCLUDE USING gist (
        episode_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    );

-- FK CONSTRAINT: episode_campaign_prices episode_campaign_prices_tenant_id_fkey
ALTER TABLE ONLY episode_campaign_prices
    ADD CONSTRAINT episode_campaign_prices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_campaign_prices episode_campaign_prices_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY episode_campaign_prices
    ADD CONSTRAINT episode_campaign_prices_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_campaign_prices episode_campaign_prices_tenant_created_by_user_id_fkey
-- Composite, with SET NULL naming the one column, for the reason
-- episode_free_windows_tenant_created_by_user_id_fkey gives.
ALTER TABLE ONLY episode_campaign_prices
    ADD CONSTRAINT episode_campaign_prices_tenant_created_by_user_id_fkey FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by_user_id);

-- INDEX: idx_episode_campaign_prices_episode_period
-- Which campaign, if any, is on one episode now, and the console's list of one
-- episode's campaigns.
CREATE INDEX idx_episode_campaign_prices_episode_period ON episode_campaign_prices USING btree (episode_id, starts_at, ends_at);

-- INDEX: idx_episode_campaign_prices_pending_boundaries
-- The apply-campaign-prices batch, which reads only the rows with a boundary
-- it has not applied yet.
CREATE INDEX idx_episode_campaign_prices_pending_boundaries ON episode_campaign_prices USING btree (starts_at, ends_at)
    WHERE ((start_revalidated_at IS NULL) OR (end_revalidated_at IS NULL));

-- INDEX: idx_episode_campaign_prices_tenant_id
CREATE INDEX idx_episode_campaign_prices_tenant_id ON episode_campaign_prices USING btree (tenant_id);

-- ROW SECURITY: episode_campaign_prices
ALTER TABLE episode_campaign_prices ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_campaign_prices episode_campaign_prices_tenant_isolation
CREATE POLICY episode_campaign_prices_tenant_isolation ON episode_campaign_prices USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- VIEW: open_episode_campaign_prices
-- The campaign on each episode at this moment: what its permanent copy sells
-- for, and when that price ends. The checkout charges it and the catalog shows
-- it, so the two read the one rule here. A campaign that no longer undercuts
-- the listing, because an editor lowered the price under it since, is not
-- open: it would raise the price rather than cut it.
CREATE VIEW open_episode_campaign_prices WITH (security_invoker = true) AS
SELECT cp.episode_id,
    cp.tenant_id,
    cp.price AS campaign_price,
    cp.ends_at AS campaign_ends_at
FROM episode_campaign_prices cp
    JOIN episode_listings el ON el.episode_id = cp.episode_id
WHERE cp.starts_at <= NOW()
    AND cp.ends_at > NOW()
    AND cp.price < el.price;
