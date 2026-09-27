ALTER TABLE ONLY tenant_payment_config
    DROP CONSTRAINT tenant_payment_config_credential_hints_object_check,
    DROP CONSTRAINT tenant_payment_config_credentials_encrypted_envelope_check;

ALTER TABLE tenant_payment_config
    ALTER COLUMN provider SET DEFAULT 'stripe'::character varying;

ALTER TABLE tenant_payment_config
    ADD COLUMN secret_key_encrypted text,
    ADD COLUMN webhook_secret_encrypted text,
    ADD COLUMN secret_key_hint text,
    ADD COLUMN webhook_secret_hint text;

-- The old columns hold Stripe's two secrets and nothing else. A row on another
-- provider has no representation there, so it goes back to an unconfigured,
-- disabled Stripe row, and a Stripe row missing either secret is disabled, as
-- the old constraints require.
UPDATE tenant_payment_config
SET provider = 'stripe',
    enabled = false,
    credentials_encrypted = '{}'::jsonb,
    credential_hints = '{}'::jsonb
WHERE provider <> 'stripe';

UPDATE tenant_payment_config
SET enabled = false
WHERE enabled
    AND NOT (credentials_encrypted ?& ARRAY['secret_key', 'webhook_secret']);

UPDATE tenant_payment_config
SET secret_key_encrypted = credentials_encrypted ->> 'secret_key',
    webhook_secret_encrypted = credentials_encrypted ->> 'webhook_secret',
    secret_key_hint = credential_hints ->> 'secret_key',
    webhook_secret_hint = credential_hints ->> 'webhook_secret';

ALTER TABLE tenant_payment_config
    DROP COLUMN credential_hints,
    DROP COLUMN credentials_encrypted;

ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_provider_check CHECK (((provider)::text = 'stripe'::text)),
    ADD CONSTRAINT tenant_payment_config_secret_key_encrypted_envelope_check CHECK (((secret_key_encrypted IS NULL) OR (secret_key_encrypted LIKE 'enc:%'::text))),
    ADD CONSTRAINT tenant_payment_config_webhook_secret_encrypted_envelope_check CHECK (((webhook_secret_encrypted IS NULL) OR (webhook_secret_encrypted LIKE 'enc:%'::text))),
    ADD CONSTRAINT tenant_payment_config_enabled_requires_secrets CHECK (((NOT enabled) OR ((secret_key_encrypted IS NOT NULL) AND (btrim(secret_key_encrypted) <> ''::text) AND (webhook_secret_encrypted IS NOT NULL) AND (btrim(webhook_secret_encrypted) <> ''::text))));
