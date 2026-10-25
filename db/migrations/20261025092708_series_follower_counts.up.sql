-- How many readers follow a series, and how that number moved, for the
-- console's audience statistics.
--
-- series_follows answers neither for the console. Its rows are member-isolated,
-- so a publira_admin connection sees none of its readers' follows, and a follow
-- taken back is deleted, so the table only ever says who follows a series now.
-- What the console needs is a number per series and the days it rose and fell
-- on, and the two tables here keep both without a reader's id in either.

-- TABLE: series_follower_counts
-- The readers following the series now. It is a stored tally for the reasons
-- series_rating_counts is: the rows behind it are hidden from the connection
-- that reads it, and counting them per request would read every follow the
-- series has.
CREATE TABLE series_follower_counts (
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT series_follower_counts_count_nonneg_check CHECK ((count >= 0))
);

-- CONSTRAINT: series_follower_counts series_follower_counts_pkey
ALTER TABLE ONLY series_follower_counts
    ADD CONSTRAINT series_follower_counts_pkey PRIMARY KEY (tenant_id, series_id);

-- FK CONSTRAINT: series_follower_counts series_follower_counts_tenant_series_id_fkey
ALTER TABLE ONLY series_follower_counts
    ADD CONSTRAINT series_follower_counts_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: series_follower_counts
ALTER TABLE series_follower_counts ENABLE ROW LEVEL SECURITY;

-- POLICY: series_follower_counts series_follower_counts_tenant_isolation
CREATE POLICY series_follower_counts_tenant_isolation ON series_follower_counts
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_follow_changes
-- One row per follow made (+1) and per follow ended (-1), at the instant it
-- happened. A follow ends when the reader takes it back and when their account
-- goes, and both are a -1 here, so the number of followers at any instant is
-- the tally less every change after it.
--
-- It keeps the instant rather than a day, because the day a change falls on is
-- the tenant's own and the tenant's zone can change; the console turns the
-- instant into a day when it reads it, as the revenue report does with a
-- purchase.
--
-- Nothing here names the reader. The console counts follows; who made them is
-- not something it is shown.
CREATE TABLE series_follow_changes (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    change smallint NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT series_follow_changes_change_check CHECK (((change = '-1'::integer) OR (change = 1)))
);

-- CONSTRAINT: series_follow_changes series_follow_changes_pkey
ALTER TABLE ONLY series_follow_changes
    ADD CONSTRAINT series_follow_changes_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: series_follow_changes series_follow_changes_tenant_series_id_fkey
ALTER TABLE ONLY series_follow_changes
    ADD CONSTRAINT series_follow_changes_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_series_follow_changes_tenant_changed_at
-- A tenant's changes from an instant on, across every series: the day report of
-- the whole tenant and the series report both read the changes since a period
-- began, and the included columns let them answer from the index alone.
CREATE INDEX idx_series_follow_changes_tenant_changed_at ON series_follow_changes USING btree (tenant_id, changed_at) INCLUDE (series_id, change);

-- INDEX: idx_series_follow_changes_tenant_series_changed_at
-- One series' changes from an instant on, for a report narrowed to it, and the
-- walk the cascade from a deleted series takes.
CREATE INDEX idx_series_follow_changes_tenant_series_changed_at ON series_follow_changes USING btree (tenant_id, series_id, changed_at) INCLUDE (change);

-- ROW SECURITY: series_follow_changes
ALTER TABLE series_follow_changes ENABLE ROW LEVEL SECURITY;

-- POLICY: series_follow_changes series_follow_changes_tenant_isolation
CREATE POLICY series_follow_changes_tenant_isolation ON series_follow_changes
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: series_follows_record_change
-- Moves the tally and records the change for every follow made and ended.
--
-- It is a trigger rather than a statement in the handler because a follow is
-- not only ended by a request: deleting an account cascades through
-- series_follows, and that delete is performed by PostgreSQL itself, where no
-- handler runs. Those readers leave the series as surely as one who unfollows,
-- and a tally kept by callers would keep counting them.
--
-- The change of a follow that ends because its series is being deleted is not
-- recorded. The series' changes and its tally go with it by their own foreign
-- keys, and a row naming the series could not be inserted once it is gone.
--
-- SECURITY DEFINER because the API roles may not write either table, so the
-- numbers can only move through this function. It takes nothing from the
-- caller: every value comes from the row the trigger fired for, which
-- row-level security already vouched for on series_follows, and search_path is
-- fixed so the body cannot be pointed at another schema's tables.
CREATE FUNCTION series_follows_record_change() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO series_follower_counts (tenant_id, series_id, count)
        VALUES (NEW.tenant_id, NEW.series_id, 1)
        ON CONFLICT (tenant_id, series_id) DO UPDATE
        SET count = series_follower_counts.count + 1;
        INSERT INTO series_follow_changes (tenant_id, series_id, change, changed_at)
        VALUES (NEW.tenant_id, NEW.series_id, 1, NEW.created_at);
        RETURN NEW;
    END IF;
    UPDATE series_follower_counts
    SET count = count - 1
    WHERE tenant_id = OLD.tenant_id
        AND series_id = OLD.series_id;
    INSERT INTO series_follow_changes (tenant_id, series_id, change)
    SELECT OLD.tenant_id, OLD.series_id, -1
    WHERE EXISTS (
        SELECT 1
        FROM series s
        WHERE s.tenant_id = OLD.tenant_id
            AND s.id = OLD.series_id
    );
    RETURN OLD;
END;
$$;

-- TRIGGER: series_follows series_follows_record_follow
CREATE TRIGGER series_follows_record_follow
    AFTER INSERT ON series_follows
    FOR EACH ROW
    EXECUTE FUNCTION series_follows_record_change();

-- TRIGGER: series_follows series_follows_record_unfollow
CREATE TRIGGER series_follows_record_unfollow
    AFTER DELETE ON series_follows
    FOR EACH ROW
    EXECUTE FUNCTION series_follows_record_change();

-- Both tables open holding the follows already stored. The triggers above were
-- created first, in this same transaction, and hold series_follows against
-- writes until it commits, so no follow is counted twice or missed between
-- them. The follows ended before this migration left nothing behind, so the
-- history starts with every follow that still stands, made when it was made.
INSERT INTO series_follower_counts (tenant_id, series_id, count)
SELECT sf.tenant_id, sf.series_id, count(*)
FROM series_follows sf
GROUP BY sf.tenant_id, sf.series_id;

INSERT INTO series_follow_changes (tenant_id, series_id, change, changed_at)
SELECT sf.tenant_id, sf.series_id, 1, sf.created_at
FROM series_follows sf;
