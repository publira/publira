-- How often one reader may ask AuthService.LinkIdentity to link a provider
-- account. A reader links at most one account per provider, but a refused link
-- spends no nonce, so the same sign-in can be sent again, and each request
-- verifies an ID token and reads the tenant's sign-in settings and links.

-- COLUMN: platform_policy_config identity_link_limit_per_minute
-- COLUMN: platform_policy_config identity_link_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN identity_link_limit_per_minute integer DEFAULT 5 NOT NULL,
    ADD COLUMN identity_link_limit_per_day integer DEFAULT 20 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN identity_link_limit_per_minute DROP DEFAULT,
    ALTER COLUMN identity_link_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_identity_link_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_identity_link_limit_check CHECK (((identity_link_limit_per_minute >= 1) AND (identity_link_limit_per_day >= identity_link_limit_per_minute)));
