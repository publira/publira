-- INDEX: idx_contact_messages_tenant_assigned_to
-- The referencing side of contact_messages_tenant_assigned_to_fkey, for the
-- same reason idx_contact_messages_tenant_handled_by exists: without it,
-- deleting a staff account scans every message the platform ever received.
--
-- CONCURRENTLY, so building it does not block the messages readers keep
-- sending, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_contact_messages_tenant_assigned_to ON contact_messages USING btree (tenant_id, assigned_to) WHERE (assigned_to IS NOT NULL);
