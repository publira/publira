CREATE OR REPLACE FUNCTION episode_rating_counts_follow_ratings() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO episode_rating_counts (tenant_id, episode_id, count)
        VALUES (NEW.tenant_id, NEW.episode_id, 1)
        ON CONFLICT (tenant_id, episode_id) DO UPDATE
        SET count = episode_rating_counts.count + 1;
        RETURN NEW;
    END IF;
    -- No row to lower when the episode is going too, because its tally cascades
    -- with it. Matching nothing is the correct no-op there.
    UPDATE episode_rating_counts
    SET count = count - 1
    WHERE tenant_id = OLD.tenant_id
        AND episode_id = OLD.episode_id;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION series_rating_counts_follow_ratings() RETURNS trigger
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

CREATE OR REPLACE FUNCTION episode_ratings_follow_episode_deletes() RETURNS trigger
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

CREATE OR REPLACE FUNCTION series_follows_record_change() RETURNS trigger
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

CREATE OR REPLACE FUNCTION tenant_image_shown_by_brand_mark(image_tenant_id uuid, tenant_image_id uuid) RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM tenant_brand_marks bm
        WHERE bm.tenant_id = image_tenant_id
            AND bm.image_id = tenant_image_id
    );
$$;
