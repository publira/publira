-- The instants a closed month was counted between, kept on its statement. The
-- month after a statement starts where that statement ended rather than at its
-- own first midnight, so a tenant that changes its time zone between two
-- closes neither drops the hours between the two midnights nor counts them
-- twice. Those bounds are therefore not recomputable from period and
-- time_zone alone.

-- COLUMN: royalty_statements starts_at
-- COLUMN: royalty_statements ends_at
-- A statement closed before the columns existed was cut from its own first
-- midnight to the next month's, both in time_zone, which is what fills them
-- in. The immutability trigger refuses that update, so it is disabled around
-- it.
ALTER TABLE royalty_statements
    ADD COLUMN starts_at timestamp with time zone,
    ADD COLUMN ends_at timestamp with time zone;

ALTER TABLE royalty_statements DISABLE TRIGGER royalty_statements_immutable;

UPDATE royalty_statements SET
    starts_at = period::timestamp AT TIME ZONE time_zone,
    ends_at = (period + interval '1 month')::timestamp AT TIME ZONE time_zone;

ALTER TABLE royalty_statements ENABLE TRIGGER royalty_statements_immutable;

ALTER TABLE royalty_statements
    ALTER COLUMN starts_at SET NOT NULL,
    ALTER COLUMN ends_at SET NOT NULL;

-- CONSTRAINT: royalty_statements royalty_statements_bounds_check
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_bounds_check CHECK ((starts_at < ends_at));
