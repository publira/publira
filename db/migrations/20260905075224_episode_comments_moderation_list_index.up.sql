-- INDEX: idx_episode_comments_tenant_created_at
-- The moderation list with no status filter, which is how staff read one
-- episode's whole comment history rather than one queue of it. The existing
-- per-status index cannot serve that order: status sits between tenant_id and
-- created_at in its column list, so dropping the status equality leaves the
-- keyset scan sorting every comment the tenant has.
CREATE INDEX idx_episode_comments_tenant_created_at ON episode_comments USING btree (tenant_id, created_at DESC, id DESC);
