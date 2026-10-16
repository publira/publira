-- How often one reader may ask AuthService to begin registering a passkey, to
-- rename or remove one, or to begin confirming a request with one. Each begin
-- stores a ceremony, a removal locks the account row, and a rename writes the
-- credential, so what this bounds is the writes one account can make the
-- storefront repeat.

-- COLUMN: platform_policy_config passkey_limit_per_minute
-- COLUMN: platform_policy_config passkey_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN passkey_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN passkey_limit_per_day integer DEFAULT 50 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN passkey_limit_per_minute DROP DEFAULT,
    ALTER COLUMN passkey_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_passkey_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_passkey_limit_check CHECK (((passkey_limit_per_minute >= 1) AND (passkey_limit_per_day >= passkey_limit_per_minute)));
