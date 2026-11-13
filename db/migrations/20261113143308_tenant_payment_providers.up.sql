-- A tenant takes payments through more than one web provider at once: one row
-- per tenant and provider, each with the credential fields that provider
-- declares, where tenant_payment_config held one provider and dropped the
-- previous one's credentials on a switch. A checkout names the provider it is
-- sent to, and the webhook, the refund, and the reconciliation of a payment use
-- the provider it was made through.
--
-- tenant_payment_config keeps the tenant currency, which every provider the
-- tenant sells through charges in. Its provider, enabled, credentials_encrypted,
-- and credential_hints stay for the previous release, which reads and writes
-- the tenant's one provider there: two triggers keep them the first provider of
-- the new table, in both directions, and the release after this one drops the
-- triggers and the four columns.

-- TABLE: tenant_payment_providers
-- Which fields a provider has, and which of them are required, is the
-- provider's declaration in the server, as it is for tenant_payment_config.
CREATE TABLE tenant_payment_providers (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    -- Field name to a secretcrypto envelope of its value, one envelope per
    -- field so a single field can be replaced or cleared without the others.
    credentials_encrypted jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- Field name to what the console shows for a stored field without
    -- decrypting it: the masked hint of a secret field, and the value itself of
    -- a field that is not secret.
    credential_hints jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- When the tenant removed the provider. A retired provider starts no
    -- checkout, and keeps its credentials for the notifications, the refunds,
    -- and the reconciliation of what it already took, a checkout paid after
    -- the removal included, until the server deletes it. NULL for a provider
    -- the tenant sells through.
    retired_at timestamp with time zone,
    -- The order the tenant added its providers in, the first of which the
    -- previous release reads as the tenant's one.
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_payment_providers_credentials_encrypted_envelope_check CHECK (((jsonb_typeof(credentials_encrypted) = 'object'::text) AND (NOT jsonb_path_exists(credentials_encrypted, '$.* ? (@.type() != "string" || !(@ starts with "enc:"))'::jsonpath)))),
    CONSTRAINT tenant_payment_providers_credential_hints_object_check CHECK ((jsonb_typeof(credential_hints) = 'object'::text))
);

-- CONSTRAINT: tenant_payment_providers tenant_payment_providers_pkey
-- A key of one column, which the reseal of credentials_encrypted updates a row
-- by.
ALTER TABLE ONLY tenant_payment_providers
    ADD CONSTRAINT tenant_payment_providers_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_payment_providers tenant_payment_providers_tenant_provider_key
ALTER TABLE ONLY tenant_payment_providers
    ADD CONSTRAINT tenant_payment_providers_tenant_provider_key UNIQUE (tenant_id, provider);

-- FK CONSTRAINT: tenant_payment_providers tenant_payment_providers_tenant_id_fkey
ALTER TABLE ONLY tenant_payment_providers
    ADD CONSTRAINT tenant_payment_providers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_payment_providers
ALTER TABLE tenant_payment_providers ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_payment_providers tenant_payment_providers_tenant_isolation
CREATE POLICY tenant_payment_providers_tenant_isolation ON tenant_payment_providers USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

INSERT INTO tenant_payment_providers (
        tenant_id,
        provider,
        enabled,
        credentials_encrypted,
        credential_hints,
        created_at,
        updated_at
    )
SELECT tenant_id,
    provider,
    enabled,
    credentials_encrypted,
    credential_hints,
    created_at,
    updated_at
FROM tenant_payment_config;

-- FUNCTION: tenant_payment_providers_write_config
-- Writes the tenant's first provider that is not retired, the earliest added,
-- into tenant_payment_config, where the previous release reads its one
-- provider, and payments switched off when there is none. The row is the one
-- the tenant currency is stored in, which the server writes before it adds a
-- provider, so there is always one to update.
--
-- A write this function or tenant_payment_config_write_providers makes fires
-- the other one level deeper, which returns at once, so neither copies back
-- what the other has just copied. A tenant's deletion reaches both tables
-- through their foreign keys, one level deeper too.
--
-- SECURITY INVOKER: the role writing the tenant's providers writes its
-- settings row under the same row-level security.
CREATE FUNCTION tenant_payment_providers_write_config() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $$
DECLARE
    target_tenant_id uuid;
    first public.tenant_payment_providers%ROWTYPE;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'DELETE' THEN
        target_tenant_id := OLD.tenant_id;
    ELSE
        target_tenant_id := NEW.tenant_id;
    END IF;
    SELECT *
    INTO first
    FROM public.tenant_payment_providers
    WHERE tenant_id = target_tenant_id
        AND retired_at IS NULL
    ORDER BY created_at,
        id
    LIMIT 1;
    IF FOUND THEN
        UPDATE public.tenant_payment_config
        SET provider = first.provider,
            enabled = first.enabled,
            credentials_encrypted = first.credentials_encrypted,
            credential_hints = first.credential_hints,
            updated_at = now()
        WHERE tenant_id = target_tenant_id;
    ELSE
        UPDATE public.tenant_payment_config
        SET enabled = false,
            credentials_encrypted = '{}'::jsonb,
            credential_hints = '{}'::jsonb,
            updated_at = now()
        WHERE tenant_id = target_tenant_id;
    END IF;
    RETURN NULL;
END;
$$;

-- FUNCTION: tenant_payment_config_write_providers
-- Writes what the previous release saved as the tenant's one provider into
-- tenant_payment_providers, as that release means it: the first provider the
-- tenant sells through, whose credentials a switch to another provider
-- deletes. The provider switched to takes the first one's place, and keeps the
-- row it has when the tenant holds it already.
--
-- SECURITY INVOKER, as tenant_payment_providers_write_config is.
CREATE FUNCTION tenant_payment_config_write_providers() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $$
DECLARE
    first_provider character varying(32);
    first_created_at timestamp with time zone;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    SELECT provider,
        created_at
    INTO first_provider,
        first_created_at
    FROM public.tenant_payment_providers
    WHERE tenant_id = NEW.tenant_id
        AND retired_at IS NULL
    ORDER BY created_at,
        id
    LIMIT 1;
    IF first_provider IS NOT NULL AND first_provider <> NEW.provider THEN
        DELETE FROM public.tenant_payment_providers
        WHERE tenant_id = NEW.tenant_id
            AND provider = first_provider;
    END IF;
    INSERT INTO public.tenant_payment_providers (
            tenant_id,
            provider,
            enabled,
            credentials_encrypted,
            credential_hints,
            created_at,
            updated_at
        )
    VALUES (
            NEW.tenant_id,
            NEW.provider,
            NEW.enabled,
            NEW.credentials_encrypted,
            NEW.credential_hints,
            COALESCE(first_created_at, now()),
            now()
        ) ON CONFLICT (tenant_id, provider) DO
    UPDATE
    SET enabled = EXCLUDED.enabled,
        credentials_encrypted = EXCLUDED.credentials_encrypted,
        credential_hints = EXCLUDED.credential_hints,
        retired_at = NULL,
        created_at = LEAST(tenant_payment_providers.created_at, EXCLUDED.created_at),
        updated_at = now();
    RETURN NULL;
END;
$$;

-- TRIGGER: tenant_payment_providers tenant_payment_providers_write_config
CREATE TRIGGER tenant_payment_providers_write_config
    AFTER INSERT OR DELETE OR UPDATE ON tenant_payment_providers
    FOR EACH ROW
    EXECUTE FUNCTION tenant_payment_providers_write_config();

-- TRIGGER: tenant_payment_config tenant_payment_config_write_providers
-- A write of the currency alone names no provider.
CREATE TRIGGER tenant_payment_config_write_providers
    AFTER INSERT OR UPDATE OF provider, enabled, credentials_encrypted, credential_hints ON tenant_payment_config
    FOR EACH ROW
    EXECUTE FUNCTION tenant_payment_config_write_providers();
