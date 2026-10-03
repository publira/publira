ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_disposable_email_domains_url_check;

ALTER TABLE platform_policy_config
    DROP COLUMN disposable_email_domains_url;
