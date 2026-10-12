-- Fails while an enabled override names no credentials: such a row has no
-- username or password the earlier constraint could accept.
ALTER TABLE ONLY tenant_smtp_config
    DROP CONSTRAINT tenant_smtp_config_required_when_enabled;

ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_required_when_enabled CHECK (((NOT smtp_override_enabled) OR ((host IS NOT NULL) AND (port IS NOT NULL) AND (username IS NOT NULL) AND (password_encrypted IS NOT NULL) AND (encryption IS NOT NULL) AND (from_address IS NOT NULL))));
