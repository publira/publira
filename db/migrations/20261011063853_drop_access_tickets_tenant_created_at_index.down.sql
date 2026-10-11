-- INDEX: idx_access_tickets_tenant_created_at
CREATE INDEX CONCURRENTLY idx_access_tickets_tenant_created_at ON access_tickets USING btree (tenant_id, created_at DESC, id DESC);
