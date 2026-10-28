-- CONSTRAINT: tenant_analytics_settings tenant_analytics_settings_external_container_required_check
-- external leaves the reader's consent to a consent tool in the tenant's Tag
-- Manager container, so it means nothing without a container ID. A server of
-- the release that added consent_mode refuses such a save, but the release
-- before it cleared gtm_container_id without reading consent_mode, so a row
-- can have reached this state while the two ran side by side. Such a row moves
-- to opt_in, which keeps asking before the tag stores anything, so the check
-- can be added over every row.
UPDATE tenant_analytics_settings
SET consent_mode = 'opt_in'
WHERE consent_mode = 'external' AND gtm_container_id IS NULL;

ALTER TABLE ONLY tenant_analytics_settings
    ADD CONSTRAINT tenant_analytics_settings_external_container_required_check CHECK (consent_mode <> 'external' OR gtm_container_id IS NOT NULL);
