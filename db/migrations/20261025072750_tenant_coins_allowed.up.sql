-- COLUMN: platform_policy_config tenant_coins_allowed
-- Whether a tenant may issue coins at all. Coins are a stored-value
-- instrument, and in some jurisdictions the platform rather than the tenant is
-- the issuer the law looks at, so the operator decides first and a saved row
-- starts with it off. Unlike the other value columns this one keeps its
-- default: the previous release's insert does not name it.
ALTER TABLE platform_policy_config
    ADD COLUMN tenant_coins_allowed boolean DEFAULT false NOT NULL;
