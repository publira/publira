-- A tenant's payment settings hold whichever credential fields the chosen
-- provider declares, rather than exactly Stripe's secret key and webhook
-- signing secret. Which fields a provider has, and which of them are required,
-- is the provider's declaration in the server, so the table no longer names a
-- provider or a field: the provider CHECK and the rule that an enabled row
-- holds both Stripe secrets are replaced by validation against the registry.

-- COLUMN: tenant_payment_config credentials_encrypted
-- Field name to a secretcrypto envelope of its value, one envelope per field so
-- a single field can be replaced or cleared without the others.
ALTER TABLE tenant_payment_config
    ADD COLUMN credentials_encrypted jsonb DEFAULT '{}'::jsonb NOT NULL;

-- COLUMN: tenant_payment_config credential_hints
-- Field name to what the console shows for a stored field without decrypting
-- it: the masked hint of a secret field, and the value itself of a field that
-- is not secret, which is how a publishable key reaches the checkout page.
ALTER TABLE tenant_payment_config
    ADD COLUMN credential_hints jsonb DEFAULT '{}'::jsonb NOT NULL;

UPDATE tenant_payment_config
SET credentials_encrypted = jsonb_strip_nulls(jsonb_build_object(
        'secret_key', secret_key_encrypted,
        'webhook_secret', webhook_secret_encrypted
    )),
    credential_hints = jsonb_strip_nulls(jsonb_build_object(
        'secret_key', secret_key_hint,
        'webhook_secret', webhook_secret_hint
    ));

ALTER TABLE ONLY tenant_payment_config
    DROP CONSTRAINT tenant_payment_config_provider_check,
    DROP CONSTRAINT tenant_payment_config_secret_key_encrypted_envelope_check,
    DROP CONSTRAINT tenant_payment_config_webhook_secret_encrypted_envelope_check,
    DROP CONSTRAINT tenant_payment_config_enabled_requires_secrets;

ALTER TABLE tenant_payment_config
    DROP COLUMN secret_key_encrypted,
    DROP COLUMN webhook_secret_encrypted,
    DROP COLUMN secret_key_hint,
    DROP COLUMN webhook_secret_hint;

-- COLUMN: tenant_payment_config provider
-- A row is written with the provider the tenant chose, so no provider is the
-- default one.
ALTER TABLE tenant_payment_config
    ALTER COLUMN provider DROP DEFAULT;

-- CONSTRAINT: tenant_payment_config tenant_payment_config_credentials_encrypted_envelope_check
ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_credentials_encrypted_envelope_check CHECK (((jsonb_typeof(credentials_encrypted) = 'object'::text) AND (NOT jsonb_path_exists(credentials_encrypted, '$.* ? (@.type() != "string" || !(@ starts with "enc:"))'::jsonpath))));

-- CONSTRAINT: tenant_payment_config tenant_payment_config_credential_hints_object_check
ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_credential_hints_object_check CHECK ((jsonb_typeof(credential_hints) = 'object'::text));
