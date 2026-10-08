-- How often a password may be tried at sign-in, on the public API, the tenant
-- console and the platform console alike. One allowance is held per address
-- within its tenant (or the platform console), so guessing one account's
-- password stops; the other is held per client source, so trying one password
-- against many addresses stops too. A sign-in that succeeds does not count
-- against either.

-- COLUMN: platform_policy_config login_account_limit_per_minute
-- COLUMN: platform_policy_config login_account_limit_per_day
-- COLUMN: platform_policy_config login_source_limit_per_hour
-- COLUMN: platform_policy_config login_source_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN login_account_limit_per_minute integer DEFAULT 5 NOT NULL,
    ADD COLUMN login_account_limit_per_day integer DEFAULT 50 NOT NULL,
    ADD COLUMN login_source_limit_per_hour integer DEFAULT 60 NOT NULL,
    ADD COLUMN login_source_limit_per_day integer DEFAULT 300 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN login_account_limit_per_minute DROP DEFAULT,
    ALTER COLUMN login_account_limit_per_day DROP DEFAULT,
    ALTER COLUMN login_source_limit_per_hour DROP DEFAULT,
    ALTER COLUMN login_source_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_login_account_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_login_account_limit_check CHECK (((login_account_limit_per_minute >= 1) AND (login_account_limit_per_day >= login_account_limit_per_minute)));

-- CONSTRAINT: platform_policy_config platform_policy_config_login_source_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_login_source_limit_check CHECK (((login_source_limit_per_hour >= 1) AND (login_source_limit_per_day >= login_source_limit_per_hour)));
