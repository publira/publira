-- The UI locales a tenant's site offers its readers. The default locale is
-- always one of them, so the language an unprefixed URL is served in, and the
-- language the tenant's mail is sent in, is never one the site does not offer.

-- COLUMN: tenants supported_locales
-- Every tenant saved before this column existed served every locale the
-- registry knew, so it keeps all of them and no URL a reader can reach today
-- stops resolving. The default is then dropped, for the reason default_locale
-- has none: tenant creation names the set it means.
ALTER TABLE tenants
    ADD COLUMN supported_locales text[] DEFAULT ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']::text[] NOT NULL;

ALTER TABLE tenants
    ALTER COLUMN supported_locales DROP DEFAULT;

-- A default saved before this migration only had to be non-blank. One padded
-- with whitespace is read as its trimmed code, so it is stored as that code
-- from now on and meets its own in the set. One naming a code the registry
-- does not know joins the set as it is: every read of that tenant already
-- fails on it, and the upgrade must not fail with it.
UPDATE tenants
SET default_locale = btrim(default_locale)
WHERE default_locale <> btrim(default_locale);

UPDATE tenants
SET supported_locales = supported_locales || default_locale
WHERE NOT (default_locale = ANY (supported_locales));

-- CONSTRAINT: tenants tenants_supported_locales_check
-- Joining on a space and matching non-space runs rejects an empty set, a NULL
-- or blank element, and an element padded with whitespace, which a CHECK could
-- not otherwise express without a subquery.
ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_supported_locales_check CHECK (
        (array_position(supported_locales, NULL::text) IS NULL)
        AND (array_to_string(supported_locales, ' '::text) ~ '^\S+( \S+)*$'::text)
        AND (default_locale = ANY (supported_locales))
    );
