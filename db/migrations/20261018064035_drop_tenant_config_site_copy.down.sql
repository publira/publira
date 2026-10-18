ALTER TABLE ONLY tenant_config
    ADD COLUMN copyright_text text,
    ADD COLUMN site_description text,
    ADD COLUMN site_tagline text;

-- A tenant takes back its default-locale copy, or its oldest when the tenant
-- has since changed its default locale. A tenant with copy but no config row
-- gets one, since the copy lived in that row before. An empty field goes back
-- to NULL, which is what the console wrote for one.
INSERT INTO tenant_config (tenant_id, copyright_text, site_description, site_tagline)
SELECT chosen.tenant_id,
    NULLIF(chosen.copyright_text, ''),
    NULLIF(chosen.site_description, ''),
    NULLIF(chosen.site_tagline, '')
FROM (
        SELECT DISTINCT ON (tct.tenant_id) tct.tenant_id, tct.copyright_text, tct.site_description, tct.site_tagline
        FROM tenant_config_translations tct
            JOIN tenants t ON t.id = tct.tenant_id
        ORDER BY tct.tenant_id, (tct.locale = t.default_locale) DESC, tct.created_at, tct.id
    ) chosen
ON CONFLICT (tenant_id) DO UPDATE
SET copyright_text = EXCLUDED.copyright_text,
    site_description = EXCLUDED.site_description,
    site_tagline = EXCLUDED.site_tagline;
