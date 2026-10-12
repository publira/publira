DROP FUNCTION reader_has_agreed_to_page(uuid, uuid);

-- Dropping the column takes its check constraint with it.
ALTER TABLE ONLY page_versions
    DROP COLUMN agreement_required_at;
