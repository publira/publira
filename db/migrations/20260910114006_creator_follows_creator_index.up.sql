-- INDEX: idx_creator_follows_tenant_creator_user
-- The read that starts from the person: who asked to hear about them. The
-- counterpart of idx_series_follows_tenant_series_user, for the branch of the
-- new-episode fan-out that walks the episode's credits.
--
-- CONCURRENTLY, and alone in its file, for the reason given there.
CREATE INDEX CONCURRENTLY idx_creator_follows_tenant_creator_user ON creator_follows USING btree (tenant_id, creator_id, user_id);
