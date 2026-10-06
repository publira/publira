-- INDEX: contact_messages_tenant_id_id_key
-- What contact_message_entries names a message by. Its foreign key carries the
-- tenant alongside the message so an entry cannot hang under another tenant's
-- message, and PostgreSQL only accepts a composite reference against a unique
-- index on exactly those columns; the table's primary key is id alone.
--
-- CONCURRENTLY, so building it does not block the messages readers keep
-- sending, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY contact_messages_tenant_id_id_key ON contact_messages USING btree (tenant_id, id);
