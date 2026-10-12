-- A tenant's own SMTP server may be a relay that takes no credentials, which
-- the override saves with no username and no password, as the platform
-- settings already can. The sender authenticates exactly when a username is
-- saved, and the admin API refuses a password without one.

-- CONSTRAINT: tenant_smtp_config tenant_smtp_config_required_when_enabled
ALTER TABLE ONLY tenant_smtp_config
    DROP CONSTRAINT tenant_smtp_config_required_when_enabled;

ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_required_when_enabled CHECK (((NOT smtp_override_enabled) OR ((host IS NOT NULL) AND (port IS NOT NULL) AND (encryption IS NOT NULL) AND (from_address IS NOT NULL))));
