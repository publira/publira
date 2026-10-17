-- INDEX: idx_user_webauthn_ceremonies_site_source
-- The open storefront sign-in ceremonies one origin began on one tenant,
-- newest first: a begin counts them to drop all but the newest few, so what
-- one origin can leave in the table stays bounded without charging the
-- allowance a password sign-in spends.
--
-- CONCURRENTLY, so building it does not block the ceremonies the storefront
-- keeps writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_user_webauthn_ceremonies_site_source ON user_webauthn_ceremonies USING btree (tenant_id, source_digest, created_at DESC) WHERE (user_id IS NULL);
