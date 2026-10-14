-- INDEX: contact_message_entries_tenant_delivery_key_key
-- One delivery is one entry, as contact_message_entries_tenant_message_id_key
-- makes one Message-ID one entry: a mail delivered again under a key already
-- stored is a redelivery, and the webhook stores nothing for it. Partial,
-- because a staff entry never carries a key.
--
-- CONCURRENTLY, so building it does not block the replies readers keep
-- mailing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY contact_message_entries_tenant_delivery_key_key ON contact_message_entries USING btree (tenant_id, delivery_key) WHERE (delivery_key IS NOT NULL);
