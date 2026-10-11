-- idx_access_tickets_tenant_created_at ordered every ticket for the console's
-- list, which now reads only the staff ones through
-- idx_access_tickets_staff_tenant_created_at. Nothing else reads it.
--
-- CONCURRENTLY, so dropping it does not block reads of the table, which is also
-- why this statement is the whole file.
DROP INDEX CONCURRENTLY IF EXISTS idx_access_tickets_tenant_created_at;
