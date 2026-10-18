-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_item_check,
    ADD CONSTRAINT purchases_item_check CHECK ((((episode_id IS NULL) <> (volume_id IS NULL)) AND ((volume_id IS NULL) OR ((kind = 'purchase'::text) AND (store IS NULL))))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_volume_id_fkey,
    ADD CONSTRAINT purchases_tenant_volume_id_fkey FOREIGN KEY (tenant_id, volume_id) REFERENCES volumes(tenant_id, id) NOT VALID;
