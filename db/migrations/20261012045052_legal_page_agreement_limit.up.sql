-- How often one reader may ask AuthService.AgreeToLegalPages to record an
-- agreement. Agreeing to a version twice writes nothing, but every request
-- reads the tenant's legal pages and the versions it names, and a reader can
-- name each version the pages have ever published.

-- COLUMN: platform_policy_config legal_page_agreement_limit_per_minute
-- COLUMN: platform_policy_config legal_page_agreement_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN legal_page_agreement_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN legal_page_agreement_limit_per_day integer DEFAULT 50 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN legal_page_agreement_limit_per_minute DROP DEFAULT,
    ALTER COLUMN legal_page_agreement_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_legal_page_agreement_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_legal_page_agreement_limit_check CHECK (((legal_page_agreement_limit_per_minute >= 1) AND (legal_page_agreement_limit_per_day >= legal_page_agreement_limit_per_minute)));
