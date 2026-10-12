ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_identity_link_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN identity_link_limit_per_day,
    DROP COLUMN identity_link_limit_per_minute;
