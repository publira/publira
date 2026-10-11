-- INDEX: idx_access_tickets_staff_tenant_created_at
-- The console's access ticket list, newest first. It lists only the tickets
-- staff issued, and a reader's wait-for-free tickets can far outnumber them, so
-- the index holds the staff rows alone rather than leaving the list to step
-- over every reader's ticket on the way to a page.
--
-- CONCURRENTLY, so building it does not block the tickets readers and staff
-- keep creating, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_access_tickets_staff_tenant_created_at ON access_tickets USING btree (tenant_id, created_at DESC, id DESC) WHERE (source = 'staff'::text);
