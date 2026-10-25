-- TABLE: tenant_coin_config
-- The tenant's own switch for the coins its readers buy in advance and spend
-- on its episodes, and what a prepaid instrument has to disclose. A tenant
-- with no row has saved nothing and issues no coins.
--
-- selling is independent of enabled, so a tenant can stop selling packs while
-- readers spend what they hold. coin_unit_amount is what one coin is worth in
-- the minor unit of the tenant's currency, and expiry_days how long after
-- purchase a coin can be spent; both are NULL until the tenant states them,
-- because neither has a value the code could pick for every tenant.
--
-- expiry_days is capped at 100 years so that a grant's expiry, computed as the
-- purchase time plus the days, always lands in a timestamp.
CREATE TABLE tenant_coin_config (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    selling boolean DEFAULT false NOT NULL,
    coin_unit_amount integer,
    expiry_days integer,
    issuer_name text DEFAULT ''::text NOT NULL,
    terms_url text DEFAULT ''::text NOT NULL,
    contact text DEFAULT ''::text NOT NULL,
    notice text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_coin_config_coin_unit_amount_check CHECK (((coin_unit_amount IS NULL) OR (coin_unit_amount >= 1))),
    CONSTRAINT tenant_coin_config_expiry_days_check CHECK (((expiry_days IS NULL) OR ((expiry_days >= 1) AND (expiry_days <= 36500)))),
    CONSTRAINT tenant_coin_config_enabled_requires_disclosures CHECK (((NOT enabled) OR ((coin_unit_amount IS NOT NULL) AND (expiry_days IS NOT NULL) AND (btrim(issuer_name) <> ''::text) AND (btrim(terms_url) <> ''::text) AND (btrim(contact) <> ''::text) AND (btrim(notice) <> ''::text))))
);

-- CONSTRAINT: tenant_coin_config tenant_coin_config_pkey
ALTER TABLE ONLY tenant_coin_config
    ADD CONSTRAINT tenant_coin_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_coin_config tenant_coin_config_tenant_id_fkey
ALTER TABLE ONLY tenant_coin_config
    ADD CONSTRAINT tenant_coin_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_coin_config
ALTER TABLE tenant_coin_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_coin_config tenant_coin_config_tenant_isolation
CREATE POLICY tenant_coin_config_tenant_isolation ON tenant_coin_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_coin_name_translations
-- One locale's word for the tenant's coin, the unit noun that follows a number
-- ("120 Points"), so one form per locale is enough. A locale the tenant has
-- not named the coin in has no row, and a reader in it is served another
-- locale's name.
CREATE TABLE tenant_coin_name_translations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_coin_name_translations_locale_not_blank_check CHECK ((btrim(locale) <> ''::text)),
    CONSTRAINT tenant_coin_name_translations_name_check CHECK (((btrim(name) <> ''::text) AND (char_length(name) <= 30)))
);

-- CONSTRAINT: tenant_coin_name_translations tenant_coin_name_translations_pkey
ALTER TABLE ONLY tenant_coin_name_translations
    ADD CONSTRAINT tenant_coin_name_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_coin_name_translations tenant_coin_name_translations_tenant_id_locale_key
ALTER TABLE ONLY tenant_coin_name_translations
    ADD CONSTRAINT tenant_coin_name_translations_tenant_id_locale_key UNIQUE (tenant_id, locale);

-- FK CONSTRAINT: tenant_coin_name_translations tenant_coin_name_translations_tenant_id_fkey
ALTER TABLE ONLY tenant_coin_name_translations
    ADD CONSTRAINT tenant_coin_name_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_coin_name_translations
ALTER TABLE tenant_coin_name_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_coin_name_translations tenant_coin_name_translations_tenant_isolation
CREATE POLICY tenant_coin_name_translations_tenant_isolation ON tenant_coin_name_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: tenant_coin_name_for
-- The name of a tenant's coin to show for a locale: that locale's, else the
-- tenant default locale's, else the oldest, as series_translation_for picks a
-- series title. An empty locale asks for the tenant default locale's. No row
-- when the tenant has named the coin in no locale.
--
-- SECURITY INVOKER keeps tenant_coin_name_translations behind the caller's own
-- row-level security, as series_translation_for does.
CREATE FUNCTION tenant_coin_name_for(tenant_id uuid, locale text) RETURNS SETOF tenant_coin_name_translations
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT tcn.*
    FROM tenant_coin_name_translations tcn
        JOIN tenants t ON t.id = tcn.tenant_id
    WHERE tcn.tenant_id = tenant_coin_name_for.tenant_id
    ORDER BY (tcn.locale = tenant_coin_name_for.locale) DESC,
        (tcn.locale = t.default_locale) DESC,
        tcn.created_at,
        tcn.id
    LIMIT 1
$$;

-- TABLE: tenant_coin_packs
-- A pack of coins the tenant sells: the coins it grants, the bonus coins on
-- top of them, and its price in the minor unit of the tenant's currency.
-- first_sold_at is set by the first sale of the pack, and from then on its
-- price and coins are what a purchase of it bought, so they never change; a
-- tenant retires such a pack and adds another instead. A retired pack is never
-- on sale again, and stays so that a purchase can still name it.
CREATE TABLE tenant_coin_packs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    coins integer NOT NULL,
    bonus_coins integer DEFAULT 0 NOT NULL,
    price integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    on_sale boolean DEFAULT false NOT NULL,
    first_sold_at timestamp with time zone,
    retired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_coin_packs_coins_check CHECK ((coins >= 1)),
    -- The two together are what a purchase grants, so their sum stays an
    -- integer too.
    CONSTRAINT tenant_coin_packs_bonus_coins_check CHECK (((bonus_coins >= 0) AND (bonus_coins <= (2147483647 - coins)))),
    CONSTRAINT tenant_coin_packs_price_check CHECK ((price >= 1)),
    CONSTRAINT tenant_coin_packs_retired_not_on_sale_check CHECK (((retired_at IS NULL) OR (NOT on_sale)))
);

-- CONSTRAINT: tenant_coin_packs tenant_coin_packs_pkey
ALTER TABLE ONLY tenant_coin_packs
    ADD CONSTRAINT tenant_coin_packs_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_coin_packs tenant_coin_packs_tenant_id_id_key
-- Lets a purchase of a pack name it together with its tenant.
ALTER TABLE ONLY tenant_coin_packs
    ADD CONSTRAINT tenant_coin_packs_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: tenant_coin_packs tenant_coin_packs_tenant_public_id_key
ALTER TABLE ONLY tenant_coin_packs
    ADD CONSTRAINT tenant_coin_packs_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- FK CONSTRAINT: tenant_coin_packs tenant_coin_packs_tenant_id_fkey
ALTER TABLE ONLY tenant_coin_packs
    ADD CONSTRAINT tenant_coin_packs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_coin_packs
ALTER TABLE tenant_coin_packs ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_coin_packs tenant_coin_packs_tenant_isolation
CREATE POLICY tenant_coin_packs_tenant_isolation ON tenant_coin_packs USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: tenant_coin_packs_keep_sold_terms
-- Refuses changing the price or the coins of a pack once it has been sold, and
-- forgetting that it was, for every role, the platform role that bypasses RLS
-- included. Its sale state, its order, and its retirement still change.
CREATE FUNCTION tenant_coin_packs_keep_sold_terms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.first_sold_at IS NOT NULL
        AND (NEW.first_sold_at IS NULL
            OR NEW.coins <> OLD.coins
            OR NEW.bonus_coins <> OLD.bonus_coins
            OR NEW.price <> OLD.price) THEN
        RAISE EXCEPTION 'a coin pack that has been sold keeps its price and coins'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- TRIGGER: tenant_coin_packs tenant_coin_packs_keep_sold_terms
CREATE TRIGGER tenant_coin_packs_keep_sold_terms
    BEFORE UPDATE ON tenant_coin_packs
    FOR EACH ROW
    EXECUTE FUNCTION tenant_coin_packs_keep_sold_terms();
