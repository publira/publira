-- INDEX: idx_purchases_tenant_series_bundle_id
-- Which purchases bought a series bundle, and the composite foreign key to
-- series_bundles. Partial, since almost every purchase is of an episode.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_series_bundle_id ON purchases USING btree (tenant_id, series_bundle_id) WHERE (series_bundle_id IS NOT NULL);
