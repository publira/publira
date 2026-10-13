-- How often one reader may ask AuthService.UploadMyIcon or DeleteMyIcon to
-- change their icon. Each upload is decoded, scaled, and stored as an object
-- that stays in the bucket until the orphan sweep reclaims it, so what this
-- bounds is the objects one account can leave there between two sweeps.

-- COLUMN: platform_policy_config icon_change_limit_per_minute
-- COLUMN: platform_policy_config icon_change_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN icon_change_limit_per_minute integer DEFAULT 5 NOT NULL,
    ADD COLUMN icon_change_limit_per_day integer DEFAULT 20 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN icon_change_limit_per_minute DROP DEFAULT,
    ALTER COLUMN icon_change_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_icon_change_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_icon_change_limit_check CHECK (((icon_change_limit_per_minute >= 1) AND (icon_change_limit_per_day >= icon_change_limit_per_minute)));
