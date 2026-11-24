-- A save of the previous release's payment settings keeps what this release
-- keeps for a retired provider: its row and its credentials, which serve the
-- notifications, the refunds, and the reconciliation of what it already took.
-- The previous release knows only the provider tenant_payment_config shows it,
-- and carries over only the fields it reads there, so the two functions that
-- keep that row and tenant_payment_providers in step are replaced:
--
-- - With every provider retired, tenant_payment_config shows the first one,
--   switched off, with its credentials, where it showed nothing stored, so a
--   save that carries the stored fields over writes them back.
-- - Switching the previous release's one provider to another retires the
--   provider switched from, where it deleted it. Deleting it is left to this
--   release's removal, once the provider has nothing left to act on.
-- - A save of a retired provider switched off, as tenant_payment_config shows
--   it, leaves it retired and as on as it was, where it added it back switched
--   off, and nothing loads the credentials of a provider switched off.
-- - A save of a provider tenant_payment_config did not show adds the fields
--   the previous release sent to the ones the provider has, where it replaced
--   them, and tenant_payment_config is given the result.
--
-- The settings rows the replaced function left showing nothing stored are
-- written again at the end.

-- FUNCTION: tenant_payment_providers_write_config
-- Writes the tenant's first provider that is not retired, the earliest added,
-- into tenant_payment_config, where the previous release reads its one
-- provider. With none, it writes the first retired one, switched off, so the
-- previous release reads the credentials the provider keeps, and payments
-- switched off with nothing stored when the tenant holds no provider at all.
-- The row is the one the tenant currency is stored in, which the server writes
-- before it adds a provider, so there is always one to update.
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
    ORDER BY retired_at IS NOT NULL,
        created_at,
        id
    LIMIT 1;
    IF FOUND THEN
        UPDATE public.tenant_payment_config
        SET provider = first.provider,
            enabled = first.enabled AND first.retired_at IS NULL,
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
-- tenant_payment_providers. The provider saved takes the place of the first
-- one the tenant sells through, which is retired when it is another, and
-- keeps the row it has when the tenant holds it already, retired or not.
-- Saving a retired provider switched on adds it back. Saved switched off, as
-- tenant_payment_config shows a retired provider, it stays retired and keeps
-- whether it was on, which is what lets its credentials go on serving what it
-- took.
--
-- The previous release sends the fields of the provider tenant_payment_config
-- showed it as all that provider has, so a field missing from them is one it
-- cleared; of any other provider it sends only the fields typed in, which are
-- added to the ones the provider has. The provider's fields are then written
-- back to tenant_payment_config, where the previous release reads them.
--
-- SECURITY INVOKER, as tenant_payment_providers_write_config is.
CREATE OR REPLACE FUNCTION tenant_payment_config_write_providers() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $$
DECLARE
    first_provider character varying(32);
    first_created_at timestamp with time zone;
    shown_provider character varying(32);
    saved public.tenant_payment_providers%ROWTYPE;
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
    -- The provider the row showed before this write, the one the previous
    -- release read the fields of. A row being added showed none.
    IF TG_OP = 'UPDATE' THEN
        shown_provider := OLD.provider;
    END IF;
    IF first_provider IS NOT NULL AND first_provider <> NEW.provider THEN
        UPDATE public.tenant_payment_providers
        SET retired_at = now(),
            updated_at = now()
        WHERE tenant_id = NEW.tenant_id
            AND provider = first_provider;
    END IF;
    INSERT INTO public.tenant_payment_providers AS held (
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
    SET enabled = EXCLUDED.enabled
        OR (held.enabled AND held.retired_at IS NOT NULL),
        credentials_encrypted = CASE
            WHEN held.provider = shown_provider THEN EXCLUDED.credentials_encrypted
            ELSE held.credentials_encrypted || EXCLUDED.credentials_encrypted
        END,
        credential_hints = CASE
            WHEN held.provider = shown_provider THEN EXCLUDED.credential_hints
            ELSE held.credential_hints || EXCLUDED.credential_hints
        END,
        retired_at = CASE
            WHEN EXCLUDED.enabled THEN NULL
            ELSE held.retired_at
        END,
        created_at = LEAST(held.created_at, EXCLUDED.created_at),
        updated_at = now()
    RETURNING *
    INTO saved;
    IF saved.credentials_encrypted IS DISTINCT FROM NEW.credentials_encrypted
        OR saved.credential_hints IS DISTINCT FROM NEW.credential_hints THEN
        UPDATE public.tenant_payment_config
        SET credentials_encrypted = saved.credentials_encrypted,
            credential_hints = saved.credential_hints,
            updated_at = now()
        WHERE tenant_id = NEW.tenant_id;
    END IF;
    RETURN NULL;
END;
$$;

-- The settings row of a tenant whose every provider is retired still shows
-- nothing stored, as the function replaced above left it, and a save of the
-- provider it shows would now write that back over the provider's
-- credentials. Touching the tenant's providers runs
-- tenant_payment_providers_write_config, which shows the first of them with
-- its credentials; the settings row it writes runs
-- tenant_payment_config_write_providers one level deeper, which returns at
-- once.
UPDATE tenant_payment_providers AS provider
SET updated_at = provider.updated_at
WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_payment_providers AS selling
        WHERE selling.tenant_id = provider.tenant_id
            AND selling.retired_at IS NULL
    );
