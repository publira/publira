ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_legal_page_agreement_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN legal_page_agreement_limit_per_day,
    DROP COLUMN legal_page_agreement_limit_per_minute;
