-- The recipients of one notification subject in user order, which the push
-- send path pages through, so a page reads the notifications after the cursor
-- rather than every device the tenant has.
--
-- Alone in its file, and concurrent, because notifications grows with every
-- reader a tenant has times every event they are told about, and the delivery
-- path writes to it while readers are being served.
CREATE INDEX CONCURRENTLY idx_notifications_tenant_subject_user ON notifications USING btree (tenant_id, notification_type, subject_key, user_id);
