-- The banner read asks one tenant for its newest pinned row, and the ticker job
-- asks every tenant for the pinned rows whose window has passed. Both are served
-- by the partial index, which holds only the few rows that are pinned right now.
CREATE INDEX CONCURRENTLY idx_announcements_tenant_pinned ON announcements USING btree (tenant_id, created_at DESC, id DESC) WHERE pinned;
