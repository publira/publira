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

UPDATE tenant_payment_config
SET secret_key_encrypted = credentials_encrypted ->> 'secret_key',
    webhook_secret_encrypted = credentials_encrypted ->> 'webhook_secret',
    secret_key_hint = credential_hints ->> 'secret_key',
    webhook_secret_hint = credential_hints ->> 'webhook_secret';

ALTER TABLE tenant_payment_config
    DROP COLUMN credential_hints,
    DROP COLUMN credentials_encrypted;

-- A row on a provider other than Stripe, or an enabled one missing either
-- Stripe secret, has no representation here and fails these constraints.
ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_provider_check CHECK (((provider)::text = 'stripe'::text)),
    ADD CONSTRAINT tenant_payment_config_secret_key_encrypted_envelope_check CHECK (((secret_key_encrypted IS NULL) OR (secret_key_encrypted LIKE 'enc:%'::text))),
    ADD CONSTRAINT tenant_payment_config_webhook_secret_encrypted_envelope_check CHECK (((webhook_secret_encrypted IS NULL) OR (webhook_secret_encrypted LIKE 'enc:%'::text))),
    ADD CONSTRAINT tenant_payment_config_enabled_requires_secrets CHECK (((NOT enabled) OR ((secret_key_encrypted IS NOT NULL) AND (btrim(secret_key_encrypted) <> ''::text) AND (webhook_secret_encrypted IS NOT NULL) AND (btrim(webhook_secret_encrypted) <> ''::text))));
