-- The schema this returns to has no override without credentials, so one
-- saved without a username or a password is turned off: the tenant's mail goes
-- over the platform relay again, and the rest of its settings are kept for when
-- the override is turned on with credentials.
UPDATE tenant_smtp_config
SET smtp_override_enabled = false,
    updated_at = NOW()
WHERE smtp_override_enabled
    AND (username IS NULL OR password_encrypted IS NULL);

ALTER TABLE ONLY tenant_smtp_config
    DROP CONSTRAINT tenant_smtp_config_required_when_enabled;

ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_required_when_enabled CHECK (((NOT smtp_override_enabled) OR ((host IS NOT NULL) AND (port IS NOT NULL) AND (username IS NOT NULL) AND (password_encrypted IS NOT NULL) AND (encryption IS NOT NULL) AND (from_address IS NOT NULL))));
