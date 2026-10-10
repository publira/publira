ALTER TABLE ONLY royalty_statements
    DROP CONSTRAINT royalty_statements_bounds_check;

ALTER TABLE royalty_statements
    DROP COLUMN ends_at,
    DROP COLUMN starts_at;
