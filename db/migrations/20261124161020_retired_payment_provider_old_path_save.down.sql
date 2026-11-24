-- Puts back the functions as 20261113143308_tenant_payment_providers wrote them.

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
CREATE OR REPLACE FUNCTION tenant_payment_providers_write_config() RETURNS trigger
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
CREATE OR REPLACE FUNCTION tenant_payment_config_write_providers() RETURNS trigger
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
