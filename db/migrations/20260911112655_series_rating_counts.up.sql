-- How many readers have reacted to a series, counted once per reader however
-- many of its episodes they reacted to.
--
-- The figure a series is rated at needs no table of its own: content_daily_stats
-- has summed rating_sum and complete_count per series since the engagement
-- schema landed, and the rate is derived from those two. The number beside it
-- is a different question — how many people that figure speaks for — and
-- summing episode_rating_counts over the series answers a different one again:
-- that is how many reactions the series collected, five times higher for a
-- reader who worked through five episodes, and it would be shown to readers as
-- a headcount it is not.

-- TABLE: series_rating_counts
-- The readers behind a series' figure. It is a stored tally for the two reasons
-- episode_rating_counts is: every reader of a series page reads it while only a
-- few of them wrote it, and member isolation hides the ratings themselves from
-- the connection that renders the page, so a count taken over episode_ratings
-- would answer one there.
CREATE TABLE series_rating_counts (
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT series_rating_counts_count_nonneg_check CHECK ((count >= 0))
);

-- CONSTRAINT: series_rating_counts series_rating_counts_pkey
ALTER TABLE ONLY series_rating_counts
    ADD CONSTRAINT series_rating_counts_pkey PRIMARY KEY (tenant_id, series_id);

-- FK CONSTRAINT: series_rating_counts series_rating_counts_tenant_series_id_fkey
ALTER TABLE ONLY series_rating_counts
    ADD CONSTRAINT series_rating_counts_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: series_rating_counts
ALTER TABLE series_rating_counts ENABLE ROW LEVEL SECURITY;

-- POLICY: series_rating_counts series_rating_counts_tenant_isolation
CREATE POLICY series_rating_counts_tenant_isolation ON series_rating_counts
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: series_rating_counts_follow_ratings
-- Keeps the tally equal to the readers behind it. A reader joins a series with
-- the first of its episodes they react to and leaves it with the last, so the
-- number moves at those two edges and every reaction in between changes
-- nothing. Raising a score is an UPDATE, which fires neither trigger for the
-- same reason: the reader was already counted.
--
-- It is a trigger for the reason the episode tally's is — a rating is also
-- removed by a delete no handler performs, the cascade from a departing
-- account, and a tally maintained by callers would drift upwards by one per
-- reader with no path left to bring it down.
--
-- It is a statement trigger over transition tables rather than a row trigger,
-- which is where it parts from the episode tally. That tally counts one rating
-- per row, so one row is one decrement and the rows of a statement are
-- independent. This one counts readers, so the rows of a statement are not: the
-- account cascade removes every rating a departing reader gave in one DELETE,
-- and a row trigger asking "did this reader have any rating left" would have
-- been answered "no" once per episode they had reacted to, taking the series
-- down by as many as the reader had read.
--
-- SECURITY DEFINER because the storefront role is not allowed to write this
-- table, and because the question the trigger asks — has this reader reacted to
-- another episode of the series — is one member isolation would answer over the
-- caller's own rows alone. It takes nothing from the caller: every value comes
-- from the rows the trigger fired for, which row-level security already vouched
-- for on episode_ratings, and search_path is fixed so the body cannot be
-- pointed at another schema's tables.
--
-- Every path into this function resolves the series through the episode the
-- reaction names, so the episode row has to still be there when it runs.
-- episode_ratings_follow_episode_deletes below is what guarantees that for the
-- one delete that would otherwise arrive too late.
CREATE FUNCTION series_rating_counts_follow_ratings() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
DECLARE
    reader record;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- One reader arriving at one series is serialised against themselves,
        -- so two reactions committing at once on different episodes cannot both
        -- find themselves to be the first and count the reader twice. The lock
        -- is taken after the per-rating lock the handler already holds and
        -- never before it, so the two orders cannot cross.
        --
        -- The loop is what puts the locks of one statement in a fixed order.
        -- Ordering the rows a single PERFORM reads would not: the order a
        -- target-list function is evaluated in is undefined, and PostgreSQL is
        -- free to call it before the sort, which would let two statements
        -- covering the same pair of series take their locks the opposite way
        -- round and deadlock.
        FOR reader IN
            SELECT DISTINCT a.tenant_id, a.user_id, e.series_id
            FROM added a
                JOIN episodes e ON e.tenant_id = a.tenant_id AND e.id = a.episode_id
            ORDER BY 1, 2, 3
        LOOP
            PERFORM pg_advisory_xact_lock(
                hashtextextended(
                    reader.tenant_id::text || reader.user_id::text || reader.series_id::text,
                    0
                )
            );
        END LOOP;

        INSERT INTO series_rating_counts (tenant_id, series_id, count)
        SELECT t.tenant_id, t.series_id, count(*)
        FROM (
            SELECT DISTINCT a.tenant_id, a.user_id, e.series_id
            FROM added a
                JOIN episodes e ON e.tenant_id = a.tenant_id AND e.id = a.episode_id
        ) t
        -- Readers this statement brought to the series, which are the ones with
        -- no reaction to it that this statement did not just write.
        WHERE NOT EXISTS (
            SELECT 1
            FROM episode_ratings er
                JOIN episodes e ON e.tenant_id = er.tenant_id AND e.id = er.episode_id
            WHERE er.tenant_id = t.tenant_id
                AND er.user_id = t.user_id
                AND e.series_id = t.series_id
                AND NOT EXISTS (
                    SELECT 1
                    FROM added a
                    WHERE a.tenant_id = er.tenant_id
                        AND a.user_id = er.user_id
                        AND a.episode_id = er.episode_id
                )
        )
        GROUP BY t.tenant_id, t.series_id
        ON CONFLICT (tenant_id, series_id) DO UPDATE
        SET count = series_rating_counts.count + EXCLUDED.count;
        RETURN NULL;
    END IF;

    FOR reader IN
        SELECT DISTINCT r.tenant_id, r.user_id, e.series_id
        FROM removed r
            JOIN episodes e ON e.tenant_id = r.tenant_id AND e.id = r.episode_id
        ORDER BY 1, 2, 3
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                reader.tenant_id::text || reader.user_id::text || reader.series_id::text,
                0
            )
        );
    END LOOP;

    UPDATE series_rating_counts src
    SET count = src.count - departed.readers
    FROM (
        SELECT t.tenant_id, t.series_id, count(*) AS readers
        FROM (
            SELECT DISTINCT r.tenant_id, r.user_id, e.series_id
            FROM removed r
                JOIN episodes e ON e.tenant_id = r.tenant_id AND e.id = r.episode_id
        ) t
        -- Readers this statement took off the series, which are the ones with
        -- nothing of theirs left on it now the statement has run.
        WHERE NOT EXISTS (
            SELECT 1
            FROM episode_ratings er
                JOIN episodes e ON e.tenant_id = er.tenant_id AND e.id = er.episode_id
            WHERE er.tenant_id = t.tenant_id
                AND er.user_id = t.user_id
                AND e.series_id = t.series_id
        )
        GROUP BY t.tenant_id, t.series_id
    ) departed
    WHERE src.tenant_id = departed.tenant_id
        AND src.series_id = departed.series_id;
    RETURN NULL;
END;
$$;

-- TRIGGER: episode_ratings episode_ratings_raise_series_count
CREATE TRIGGER episode_ratings_raise_series_count
    AFTER INSERT ON episode_ratings
    REFERENCING NEW TABLE AS added
    FOR EACH STATEMENT
    EXECUTE FUNCTION series_rating_counts_follow_ratings();

-- TRIGGER: episode_ratings episode_ratings_lower_series_count
CREATE TRIGGER episode_ratings_lower_series_count
    AFTER DELETE ON episode_ratings
    REFERENCING OLD TABLE AS removed
    FOR EACH STATEMENT
    EXECUTE FUNCTION series_rating_counts_follow_ratings();

-- FUNCTION: episode_ratings_follow_episode_deletes
-- Takes a removed episode's reactions away while the episode is still there to
-- name the series they belong to.
--
-- Without this the reactions would go by the foreign key's own cascade, which
-- PostgreSQL runs after the episode row is gone. The tally trigger resolves the
-- series by joining episodes, so it would find nothing, leave the count where
-- it was, and the series would keep counting readers whose only reaction to it
-- had just been deleted — with no path left to bring the number back down.
-- Deleting the rows here instead leaves the cascade nothing to do.
--
-- The episode tally needs no such help: episode_rating_counts is keyed by the
-- episode and cascades with it.
--
-- SECURITY DEFINER for the reason the tally trigger is: episode_ratings is
-- member-isolated, and this delete has to reach every reader's rows rather than
-- the caller's own.
CREATE FUNCTION episode_ratings_follow_episode_deletes() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
BEGIN
    DELETE FROM episode_ratings
    WHERE tenant_id = OLD.tenant_id
        AND episode_id = OLD.id;
    RETURN OLD;
END;
$$;

-- TRIGGER: episodes episodes_release_ratings
CREATE TRIGGER episodes_release_ratings
    BEFORE DELETE ON episodes
    FOR EACH ROW
    EXECUTE FUNCTION episode_ratings_follow_episode_deletes();

-- The tally is derived, so it opens holding the reactions already stored rather
-- than zero. This is the one moment nothing else can compute it: from here the
-- triggers above carry it.
INSERT INTO series_rating_counts (tenant_id, series_id, count)
SELECT er.tenant_id, e.series_id, count(DISTINCT er.user_id)
FROM episode_ratings er
    JOIN episodes e ON e.tenant_id = er.tenant_id AND e.id = er.episode_id
GROUP BY er.tenant_id, e.series_id;
