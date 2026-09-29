-- Episode ratings: the score a reader builds by pressing, the tally everyone
-- sees, and the setting that decides how expressive one press is.
--
-- content_events already carries a 'rating' event with a 1-5 rating_score that
-- may name an episode, content_daily_stats already aggregates rating_count and
-- rating_sum per episode and rolls them up to the series, and the feature build
-- already sums them per reader. None of that is touched here. What is missing
-- is the two things an append-only event stream cannot answer: what a reader's
-- rating stands at now, and how many readers have given one.

-- TABLE: episode_ratings
-- One reader's rating of one episode, on a 1-5 scale with no neutral point:
-- more is better, and there is no way to say an episode was bad. The composite
-- primary key is the rating, so pressing again raises the score already there
-- rather than filing a second one.
--
-- The score only ever goes up. A rating cannot be taken back, so this table has
-- no delete path of its own; the one delete it sees is the cascade from a
-- removed account or episode.
CREATE TABLE episode_ratings (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    score smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT episode_ratings_score_check CHECK (((score >= 1) AND (score <= 5)))
);

-- CONSTRAINT: episode_ratings episode_ratings_pkey
ALTER TABLE ONLY episode_ratings
    ADD CONSTRAINT episode_ratings_pkey PRIMARY KEY (tenant_id, user_id, episode_id);

-- FK CONSTRAINT: episode_ratings episode_ratings_tenant_episode_id_fkey
ALTER TABLE ONLY episode_ratings
    ADD CONSTRAINT episode_ratings_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_ratings episode_ratings_tenant_user_id_fkey
ALTER TABLE ONLY episode_ratings
    ADD CONSTRAINT episode_ratings_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_episode_ratings_tenant_episode
-- The ratings of one episode, which is what a tally rebuilt from these rows
-- reads and what the cascade from a deleted episode walks. The primary key
-- leads with the reader, so it answers neither.
CREATE INDEX idx_episode_ratings_tenant_episode ON episode_ratings USING btree (tenant_id, episode_id);

-- ROW SECURITY: episode_ratings
ALTER TABLE episode_ratings ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_ratings episode_ratings_member_isolation
-- A rating is the reader's own, like a follow: nobody else's row is visible on
-- a storefront connection, and the number everyone does see lives in
-- episode_rating_counts rather than in a count over this table.
CREATE POLICY episode_ratings_member_isolation ON episode_ratings
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- TABLE: episode_rating_counts
-- How many readers have rated the episode. It counts readers rather than the
-- points they gave on purpose: a tenant whose readers press once store a 5
-- each, so a sum would read five times higher there than in a tenant whose
-- readers press their way up, and the same screen would mean two different
-- things. The points are what the ranking reads, and content_daily_stats
-- already sums them out of content_events.
--
-- It is a stored number rather than a count over the ratings because every
-- reader of an episode reads it while only one of them wrote it, and because
-- member isolation hides those rows from the connection that renders the
-- episode.
CREATE TABLE episode_rating_counts (
    tenant_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT episode_rating_counts_count_nonneg_check CHECK ((count >= 0))
);

-- CONSTRAINT: episode_rating_counts episode_rating_counts_pkey
ALTER TABLE ONLY episode_rating_counts
    ADD CONSTRAINT episode_rating_counts_pkey PRIMARY KEY (tenant_id, episode_id);

-- FK CONSTRAINT: episode_rating_counts episode_rating_counts_tenant_episode_id_fkey
ALTER TABLE ONLY episode_rating_counts
    ADD CONSTRAINT episode_rating_counts_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: episode_rating_counts
ALTER TABLE episode_rating_counts ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_rating_counts episode_rating_counts_tenant_isolation
CREATE POLICY episode_rating_counts_tenant_isolation ON episode_rating_counts
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: episode_rating_counts_follow_ratings
-- Keeps the tally equal to the readers behind it.
--
-- It is a trigger rather than a statement in the handler because a rating is
-- not only removed by a request: deleting an account cascades through
-- episode_ratings, and that delete is performed by PostgreSQL itself, where no
-- handler runs. A tally maintained by callers would drift upwards by one per
-- departing reader, with no path left to bring it back down, because a rating
-- cannot be withdrawn at all.
--
-- Raising an existing score is an UPDATE, which fires neither trigger: the
-- reader was already counted, and pressing again does not make them two.
--
-- SECURITY DEFINER because the storefront role is not allowed to write this
-- table: the baseline seed revokes its DML, so the tally can only move through
-- this function and never through a statement a request path sends. It reads
-- nothing from the caller — the tenant and the episode come from the row the
-- trigger was fired for, which row-level security already vouched for on
-- episode_ratings — and search_path is fixed so the body cannot be pointed at
-- another schema's tables.
CREATE FUNCTION episode_rating_counts_follow_ratings() RETURNS trigger
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

-- TRIGGER: episode_ratings episode_ratings_raise_count
CREATE TRIGGER episode_ratings_raise_count
    AFTER INSERT ON episode_ratings
    FOR EACH ROW
    EXECUTE FUNCTION episode_rating_counts_follow_ratings();

-- TRIGGER: episode_ratings episode_ratings_lower_count
CREATE TRIGGER episode_ratings_lower_count
    AFTER DELETE ON episode_ratings
    FOR EACH ROW
    EXECUTE FUNCTION episode_rating_counts_follow_ratings();

-- COLUMN: tenant_config episode_rating_mode
-- How expressive a rating is in this tenant. 'single' is a plain button: one
-- press and the reader has said everything they can say. 'multiple' lets them
-- press their way up to five.
--
-- A single press stores 5 rather than 1, so that a tenant that later opens the
-- rating up does not turn every press already given into the weakest one on
-- record. Changing this setting therefore never rewrites a stored score, in
-- either direction.
ALTER TABLE tenant_config
    ADD COLUMN episode_rating_mode text DEFAULT 'single'::text NOT NULL;

ALTER TABLE tenant_config
    ADD CONSTRAINT tenant_config_episode_rating_mode_check CHECK ((episode_rating_mode = ANY (ARRAY['single'::text, 'multiple'::text])));

-- COLUMN: series_listings episode_rating_mode
-- One series' own answer, overriding the tenant's. NULL is the ordinary state
-- and means the tenant decides, the way reading_period_hours defers.
ALTER TABLE series_listings
    ADD COLUMN episode_rating_mode text;

ALTER TABLE series_listings
    ADD CONSTRAINT series_listings_episode_rating_mode_check CHECK (((episode_rating_mode IS NULL) OR (episode_rating_mode = ANY (ARRAY['single'::text, 'multiple'::text]))));
