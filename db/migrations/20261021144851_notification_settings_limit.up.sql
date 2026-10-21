-- How often one reader may ask AuthService.UpdateNotificationSettings to store
-- their notification settings. Each request upserts the reader's settings row,
-- so what this bounds is the writes one account can make the storefront
-- repeat. It is a community limit, so a tenant may tighten it for itself.

-- COLUMN: platform_policy_config notification_settings_limit_per_minute
-- COLUMN: platform_policy_config notification_settings_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN notification_settings_limit_per_minute integer DEFAULT 30 NOT NULL,
    ADD COLUMN notification_settings_limit_per_day integer DEFAULT 300 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN notification_settings_limit_per_minute DROP DEFAULT,
    ALTER COLUMN notification_settings_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_notification_settings_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_notification_settings_limit_check CHECK (((notification_settings_limit_per_minute >= 1) AND (notification_settings_limit_per_day >= notification_settings_limit_per_minute)));

-- COLUMN: tenant_community_limit_overrides notification_settings_limit_per_minute
-- COLUMN: tenant_community_limit_overrides notification_settings_limit_per_day
-- NULL follows the platform policy, which is what every tenant saved so far
-- has asked for this limit.
ALTER TABLE tenant_community_limit_overrides
    ADD COLUMN notification_settings_limit_per_minute integer,
    ADD COLUMN notification_settings_limit_per_day integer;

-- CONSTRAINT: tenant_community_limit_overrides tenant_community_limit_overrides_notification_settings_check
ALTER TABLE ONLY tenant_community_limit_overrides
    ADD CONSTRAINT tenant_community_limit_overrides_notification_settings_check CHECK ((notification_settings_limit_per_minute IS NULL) = (notification_settings_limit_per_day IS NULL) AND (notification_settings_limit_per_minute IS NULL OR (notification_settings_limit_per_minute >= 1 AND notification_settings_limit_per_day >= notification_settings_limit_per_minute)));
