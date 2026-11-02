-- The public announcement list and the banner read a tenant's delivered rows
-- newest delivery first.
CREATE INDEX CONCURRENTLY idx_announcements_tenant_delivered_at ON announcements USING btree (tenant_id, delivered_at DESC, id DESC);
