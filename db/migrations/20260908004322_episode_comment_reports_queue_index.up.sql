-- INDEX: idx_episode_comment_reports_tenant_created_at
-- The report queue with no status filter, which is how staff read the
-- decisions they have already made beside the ones still waiting. The existing
-- per-status index cannot serve that order: status sits between tenant_id and
-- created_at in its column list, so dropping the status equality leaves the
-- keyset scan sorting every report the tenant has ever collected, and decided
-- reports are kept rather than deleted.
CREATE INDEX idx_episode_comment_reports_tenant_created_at ON episode_comment_reports USING btree (tenant_id, created_at DESC, id DESC);
