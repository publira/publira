-- COLUMN: contact_message_entries from_email
-- The address a reader entry was mailed from, which staff read beside it: the
-- reader may write back from another address than the one the message names,
-- and the answer still goes to the message's reply-to address. NULL on a staff
-- entry, whose author is the account named by author_id.
ALTER TABLE contact_message_entries
    ADD COLUMN from_email text;

-- CONSTRAINT: contact_message_entries contact_message_entries_from_email_check
-- Required on a reader entry and absent on a staff one, bounded like
-- contact_messages.reply_to_email. No reader entry is written before this
-- column exists, so every row already present is a staff entry that passes.
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_from_email_check CHECK (
        CASE
            WHEN ((direction)::text = 'reader'::text) THEN ((from_email IS NOT NULL) AND (length(from_email) > 0) AND (length(from_email) <= 254))
            ELSE (from_email IS NULL)
        END
    );
