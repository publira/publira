-- COLUMN: tenant_config copyright_text, site_description, site_tagline
-- All three belong to the tenant's site copy translations now.
ALTER TABLE ONLY tenant_config
    DROP COLUMN copyright_text,
    DROP COLUMN site_description,
    DROP COLUMN site_tagline;
