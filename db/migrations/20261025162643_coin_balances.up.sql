-- TABLE: coin_grants
-- One grant of a tenant's coins to a reader: the coins granted, the coins of
-- it still unspent, and when they expire. A reader's balance is the remaining
-- coins of the grants that have not expired, and a spend draws on the grant
-- that expires first.
--
-- expires_at is computed from the tenant's expiry_days when the grant is made
-- and never moves afterwards, so a later change to the setting does not reach
-- coins already held. The expiry job zeroes remaining_coins once it has
-- recorded the coins that lapsed, so a grant with coins remaining after its
-- expiry is one the job has yet to reach.
--
-- source names what granted the coins: a pack the reader bought, named by
-- purchase_id, or a member of staff.
CREATE TABLE coin_grants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    source text NOT NULL,
    purchase_id uuid,
    coins integer NOT NULL,
    remaining_coins integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coin_grants_coins_check CHECK ((coins >= 1)),
    CONSTRAINT coin_grants_remaining_coins_check CHECK (((remaining_coins >= 0) AND (remaining_coins <= coins))),
    CONSTRAINT coin_grants_expires_at_check CHECK ((expires_at > granted_at)),
    CONSTRAINT coin_grants_source_check CHECK ((source = ANY (ARRAY['pack_purchase'::text, 'staff'::text]))),
    CONSTRAINT coin_grants_purchase_check CHECK (((source = 'pack_purchase'::text) = (purchase_id IS NOT NULL)))
);

-- CONSTRAINT: coin_grants coin_grants_pkey
ALTER TABLE ONLY coin_grants
    ADD CONSTRAINT coin_grants_pkey PRIMARY KEY (id);

-- CONSTRAINT: coin_grants coin_grants_tenant_id_id_key
ALTER TABLE ONLY coin_grants
    ADD CONSTRAINT coin_grants_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: coin_grants coin_grants_tenant_purchase_id_key
-- A pack purchase grants its coins once, however often its payment is
-- reported.
ALTER TABLE ONLY coin_grants
    ADD CONSTRAINT coin_grants_tenant_purchase_id_key UNIQUE (tenant_id, purchase_id);

-- FK CONSTRAINT: coin_grants coin_grants_tenant_id_fkey
ALTER TABLE ONLY coin_grants
    ADD CONSTRAINT coin_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: coin_grants coin_grants_tenant_user_id_fkey
-- A deleted reader's grants stay, as their purchases do, so the history staff
-- investigate keeps every coin it accounted for.
ALTER TABLE ONLY coin_grants
    ADD CONSTRAINT coin_grants_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- FK CONSTRAINT: coin_grants coin_grants_tenant_purchase_id_fkey
ALTER TABLE ONLY coin_grants
    ADD CONSTRAINT coin_grants_tenant_purchase_id_fkey FOREIGN KEY (tenant_id, purchase_id) REFERENCES purchases(tenant_id, id);

-- INDEX: idx_coin_grants_tenant_user_unspent
-- A reader's unspent grants in the order a spend draws on them, which is also
-- what their balance and its nearest expiry are summed over.
CREATE INDEX idx_coin_grants_tenant_user_unspent ON coin_grants USING btree (tenant_id, user_id, expires_at, id) WHERE (remaining_coins > 0);

-- INDEX: idx_coin_grants_unspent_expires_at
-- The grants the expiry job is due to reach, across every tenant.
CREATE INDEX idx_coin_grants_unspent_expires_at ON coin_grants USING btree (expires_at, id) WHERE (remaining_coins > 0);

-- ROW SECURITY: coin_grants
ALTER TABLE coin_grants ENABLE ROW LEVEL SECURITY;

-- POLICY: coin_grants coin_grants_tenant_isolation
CREATE POLICY coin_grants_tenant_isolation ON coin_grants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: coin_transactions
-- The reader-facing history of a reader's coins: each grant, spend,
-- revocation, and expiry, so the reader's history and a staff investigation
-- read the same record. coins is how many coins moved, always positive; kind
-- says which way.
--
-- A grant, a revocation, and an expiry name the grant they are about, and a
-- spend names the purchase it paid for instead, drawing on the grants that
-- coin_spend_allocations lists. idempotency_key is the key the reader's client
-- sent a spend with, so a request sent twice spends once.
CREATE TABLE coin_transactions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    kind text NOT NULL,
    coins integer NOT NULL,
    grant_id uuid,
    purchase_id uuid,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coin_transactions_kind_check CHECK ((kind = ANY (ARRAY['grant'::text, 'spend'::text, 'revocation'::text, 'expiry'::text]))),
    CONSTRAINT coin_transactions_coins_check CHECK ((coins >= 1)),
    CONSTRAINT coin_transactions_subject_check CHECK ((((kind = 'spend'::text) = (purchase_id IS NOT NULL)) AND ((kind = 'spend'::text) = (grant_id IS NULL)))),
    CONSTRAINT coin_transactions_idempotency_key_check CHECK (((idempotency_key IS NULL) OR ((kind = 'spend'::text) AND (char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200))))
);

-- CONSTRAINT: coin_transactions coin_transactions_pkey
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_pkey PRIMARY KEY (id);

-- CONSTRAINT: coin_transactions coin_transactions_tenant_id_id_key
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: coin_transactions coin_transactions_grant_id_kind_key
-- A grant is granted, revoked, and expired once each. A spend names no grant,
-- and NULLs are distinct, so spends are not held to it.
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_grant_id_kind_key UNIQUE (grant_id, kind);

-- CONSTRAINT: coin_transactions coin_transactions_tenant_purchase_id_key
-- A purchase paid with coins is paid by one spend.
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_purchase_id_key UNIQUE (tenant_id, purchase_id);

-- CONSTRAINT: coin_transactions coin_transactions_tenant_user_idempotency_key_key
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_user_idempotency_key_key UNIQUE (tenant_id, user_id, idempotency_key);

-- FK CONSTRAINT: coin_transactions coin_transactions_tenant_id_fkey
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: coin_transactions coin_transactions_tenant_user_id_fkey
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- FK CONSTRAINT: coin_transactions coin_transactions_tenant_grant_id_fkey
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_grant_id_fkey FOREIGN KEY (tenant_id, grant_id) REFERENCES coin_grants(tenant_id, id);

-- FK CONSTRAINT: coin_transactions coin_transactions_tenant_purchase_id_fkey
ALTER TABLE ONLY coin_transactions
    ADD CONSTRAINT coin_transactions_tenant_purchase_id_fkey FOREIGN KEY (tenant_id, purchase_id) REFERENCES purchases(tenant_id, id);

-- INDEX: idx_coin_transactions_tenant_user_created_at
-- The reader's history, newest first, as its keyset pages walk it.
CREATE INDEX idx_coin_transactions_tenant_user_created_at ON coin_transactions USING btree (tenant_id, user_id, created_at DESC, id DESC);

-- ROW SECURITY: coin_transactions
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;

-- POLICY: coin_transactions coin_transactions_tenant_isolation
CREATE POLICY coin_transactions_tenant_isolation ON coin_transactions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: coin_spend_allocations
-- The coins one spend drew from each grant, so that what a spent coin was
-- worth, and which spends a revoked grant had paid for, can be read back.
CREATE TABLE coin_spend_allocations (
    tenant_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    coins integer NOT NULL,
    CONSTRAINT coin_spend_allocations_coins_check CHECK ((coins >= 1))
);

-- CONSTRAINT: coin_spend_allocations coin_spend_allocations_pkey
ALTER TABLE ONLY coin_spend_allocations
    ADD CONSTRAINT coin_spend_allocations_pkey PRIMARY KEY (tenant_id, transaction_id, grant_id);

-- FK CONSTRAINT: coin_spend_allocations coin_spend_allocations_tenant_id_fkey
ALTER TABLE ONLY coin_spend_allocations
    ADD CONSTRAINT coin_spend_allocations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: coin_spend_allocations coin_spend_allocations_tenant_transaction_id_fkey
ALTER TABLE ONLY coin_spend_allocations
    ADD CONSTRAINT coin_spend_allocations_tenant_transaction_id_fkey FOREIGN KEY (tenant_id, transaction_id) REFERENCES coin_transactions(tenant_id, id);

-- FK CONSTRAINT: coin_spend_allocations coin_spend_allocations_tenant_grant_id_fkey
ALTER TABLE ONLY coin_spend_allocations
    ADD CONSTRAINT coin_spend_allocations_tenant_grant_id_fkey FOREIGN KEY (tenant_id, grant_id) REFERENCES coin_grants(tenant_id, id);

-- INDEX: idx_coin_spend_allocations_tenant_grant
-- The spends a grant paid for.
CREATE INDEX idx_coin_spend_allocations_tenant_grant ON coin_spend_allocations USING btree (tenant_id, grant_id);

-- ROW SECURITY: coin_spend_allocations
ALTER TABLE coin_spend_allocations ENABLE ROW LEVEL SECURITY;

-- POLICY: coin_spend_allocations coin_spend_allocations_tenant_isolation
CREATE POLICY coin_spend_allocations_tenant_isolation ON coin_spend_allocations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: platform_policy_config coin_payment_limit_per_minute
-- COLUMN: platform_policy_config coin_payment_limit_per_day
-- How often one reader may ask CoinService.PayEpisodeWithCoins to open an
-- episode with coins. Each payment writes a purchase and the coins it spent,
-- so what this bounds is the writes one account can make the storefront
-- repeat. Unlike most value columns these keep their defaults: the previous
-- release's insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN coin_payment_limit_per_minute integer DEFAULT 20 NOT NULL,
    ADD COLUMN coin_payment_limit_per_day integer DEFAULT 500 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_coin_payment_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_coin_payment_limit_check CHECK (((coin_payment_limit_per_minute >= 1) AND (coin_payment_limit_per_day >= coin_payment_limit_per_minute)));
