-- Where the server reads its list of disposable email domains. No list ships
-- with the server, so an empty value means there is no list and no domain is
-- disposable.

-- COLUMN: platform_policy_config disposable_email_domains_url
-- A saved row gets the empty value, which is what it had before the list
-- existed. The default is then dropped: no value column of this table has one,
-- so an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN disposable_email_domains_url text DEFAULT '' NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN disposable_email_domains_url DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_disposable_email_domains_url_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_disposable_email_domains_url_check CHECK (((disposable_email_domains_url = ''::text) OR ((disposable_email_domains_url ~ '^https?://'::text) AND (length(disposable_email_domains_url) <= 2048))));
