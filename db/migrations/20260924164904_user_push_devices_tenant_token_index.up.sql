-- The order the send path pages a tenant's devices in, so a page reads the
-- devices after the previous page's last token rather than every device the
-- tenant has.
--
-- Alone in its file, and concurrent, because readers register and unregister
-- devices while the index is built.
CREATE INDEX CONCURRENTLY idx_user_push_devices_tenant_token ON user_push_devices USING btree (tenant_id, token);
