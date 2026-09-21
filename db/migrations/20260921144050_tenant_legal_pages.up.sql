-- COLUMN: tenant_config terms_page_id, privacy_page_id
-- The pages a tenant names as its terms of service and its privacy policy, and
-- NULL where it has named none. A setting rather than a convention over slugs,
-- because a tenant chooses and may rename its own slugs.
ALTER TABLE ONLY tenant_config
    ADD COLUMN terms_page_id uuid,
    ADD COLUMN privacy_page_id uuid;

-- FK CONSTRAINT: tenant_config tenant_config_tenant_terms_page_id_fkey
-- Carries tenant_id so a tenant can only name a page of its own, and clears the
-- nomination alone when the page goes, leaving the row's tenant_id in place.
ALTER TABLE ONLY tenant_config
    ADD CONSTRAINT tenant_config_tenant_terms_page_id_fkey FOREIGN KEY (tenant_id, terms_page_id) REFERENCES pages(tenant_id, id) ON DELETE SET NULL (terms_page_id);

-- FK CONSTRAINT: tenant_config tenant_config_tenant_privacy_page_id_fkey
ALTER TABLE ONLY tenant_config
    ADD CONSTRAINT tenant_config_tenant_privacy_page_id_fkey FOREIGN KEY (tenant_id, privacy_page_id) REFERENCES pages(tenant_id, id) ON DELETE SET NULL (privacy_page_id);
