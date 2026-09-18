-- The (tenant_id, id) key that the composite foreign key from
-- notification_reads names, for the reason episode_images needed one, and left
-- a bare index rather than promoted to a constraint for the reason stated
-- there.
--
-- Alone in its file, and concurrent, because notifications grows with every
-- reader a tenant has times every event they are told about, and the delivery
-- path writes to it while readers are being served.
CREATE UNIQUE INDEX CONCURRENTLY notifications_tenant_id_id_key ON notifications USING btree (tenant_id, id);
