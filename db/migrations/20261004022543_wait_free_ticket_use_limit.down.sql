ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_wait_free_ticket_use_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN wait_free_ticket_use_limit_per_day,
    DROP COLUMN wait_free_ticket_use_limit_per_minute;
