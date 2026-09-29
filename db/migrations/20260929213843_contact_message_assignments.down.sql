ALTER TABLE ONLY contact_messages
    DROP CONSTRAINT contact_messages_tenant_assigned_to_fkey;

ALTER TABLE ONLY contact_messages
    DROP COLUMN staff_note,
    DROP COLUMN assigned_to;
