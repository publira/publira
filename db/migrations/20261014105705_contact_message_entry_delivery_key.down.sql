-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE contact_message_entries
    DROP COLUMN delivery_key;
