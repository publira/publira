-- The UI locales a tenant's site offers its readers. The default locale is
-- always one of them, so the language an unprefixed URL is served in, and the
-- language the tenant's mail is sent in, is never one the site does not offer.

-- FUNCTION: text_array_has_blank_element
-- Whether any element of the array is blank in the sense the default_locale
-- CHECK uses, so the set refuses exactly the values the default refuses. A CHECK
-- cannot hold the subquery that looks at every element itself.
CREATE FUNCTION text_array_has_blank_element(elements text[]) RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT COALESCE(bool_or(btrim(element) = ''), false)
    FROM unnest(elements) AS element
$$;

-- COLUMN: tenants supported_locales
-- Every tenant saved before this column existed served every locale the
-- registry knew, so it keeps all of them and no URL a reader can reach today
-- stops resolving. The default is then dropped, for the reason default_locale
-- has none: tenant creation names the set it means.
ALTER TABLE tenants
    ADD COLUMN supported_locales text[] DEFAULT ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']::text[] NOT NULL;

ALTER TABLE tenants
    ALTER COLUMN supported_locales DROP DEFAULT;

-- A default the registry does not name as it is stored — padded, or a code it
-- does not know — joins its own tenant's set as it is. Every value the previous
-- schema accepted as a default is one the CHECK below accepts as an element, so
-- no such row can stop the upgrade, and reading the tenant goes on answering
-- what it answered before.
UPDATE tenants
SET supported_locales = supported_locales || default_locale
WHERE NOT (default_locale = ANY (supported_locales));

-- CONSTRAINT: tenants tenants_supported_locales_check
ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_supported_locales_check CHECK (
        (cardinality(supported_locales) > 0)
        AND (array_position(supported_locales, NULL::text) IS NULL)
        AND (NOT text_array_has_blank_element(supported_locales))
        AND (default_locale = ANY (supported_locales))
    );
