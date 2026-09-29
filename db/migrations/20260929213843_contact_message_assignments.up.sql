-- Who on the staff owns a contact message, and the note staff keep on it.

-- COLUMN: contact_messages assigned_to
-- The member of staff working the message. It is not handled_by: that records
-- who completed it, while this names who owns it before and after, so a handled
-- message keeps its assignee and reopening it puts it back in their hands.
ALTER TABLE ONLY contact_messages
    ADD COLUMN assigned_to uuid;

-- COLUMN: contact_messages staff_note
-- One shared note staff keep alongside the inquiry, overwritten on each save
-- rather than kept as a history. NULL when nobody has written one, never an
-- empty string.
ALTER TABLE ONLY contact_messages
    ADD COLUMN staff_note text,
    ADD CONSTRAINT contact_messages_staff_note_check CHECK (((staff_note IS NULL) OR ((length(staff_note) > 0) AND (length(staff_note) <= 4000))));

-- FK CONSTRAINT: contact_messages contact_messages_tenant_assigned_to_fkey
-- SET NULL like the sender and the handler: an assignee's account going away
-- leaves the message waiting for somebody else rather than taking it along.
ALTER TABLE ONLY contact_messages
    ADD CONSTRAINT contact_messages_tenant_assigned_to_fkey FOREIGN KEY (tenant_id, assigned_to) REFERENCES users(tenant_id, id) ON DELETE SET NULL (assigned_to);
