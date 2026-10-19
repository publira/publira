-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY series_listings
    DROP CONSTRAINT series_listings_bundle_discount_percent_check,
    ADD CONSTRAINT series_listings_bundle_discount_percent_check CHECK (((bundle_discount_percent IS NULL) OR ((bundle_discount_percent >= 1) AND (bundle_discount_percent <= 99)))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_item_check,
    ADD CONSTRAINT purchases_item_check CHECK (((num_nonnulls(episode_id, volume_id, series_bundle_id) = 1) AND ((episode_id IS NOT NULL) OR ((kind = 'purchase'::text) AND (store IS NULL))))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_series_bundle_id_fkey,
    ADD CONSTRAINT purchases_tenant_series_bundle_id_fkey FOREIGN KEY (tenant_id, series_bundle_id) REFERENCES series_bundles(tenant_id, id) NOT VALID;
