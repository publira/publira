-- A series ranking cut for one age rating, so a leaderboard of all-ages work
-- can be shown to a reader who has proven nothing, and a rated one only to a
-- reader the tenant's rule lets see it. A NULL age_rating ranks every rating
-- together, which is what the recommendation order reads; episode rankings are
-- not cut by rating and keep a NULL one.
--
-- A genre's ranking has only ever admitted all-ages series, so the genre rows
-- already written are filed as that rather than as a mix they never were.
--
-- COLUMN: content_ranking_snapshots age_rating
ALTER TABLE ONLY content_ranking_snapshots
    ADD COLUMN age_rating character varying(8),
    ADD CONSTRAINT content_ranking_snapshots_age_rating_check CHECK (((age_rating)::text = ANY ((ARRAY['all'::character varying, 'r15'::character varying, 'r18'::character varying])::text[]))),
    ADD CONSTRAINT content_ranking_snapshots_age_rating_entity_type_check CHECK (((age_rating IS NULL) OR ((entity_type)::text = 'series'::text)));

UPDATE content_ranking_snapshots SET age_rating = 'all' WHERE genre_id IS NOT NULL;

ALTER TABLE ONLY content_ranking_snapshots
    ADD CONSTRAINT content_ranking_snapshots_age_rating_genre_check CHECK (((genre_id IS NULL) OR ((age_rating)::text = 'all'::text)));

DROP INDEX idx_content_ranking_snapshots_unique;

-- INDEX: idx_content_ranking_snapshots_unique
CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version, genre_id, surface, age_rating) NULLS NOT DISTINCT;

DROP INDEX idx_content_ranking_snapshots_tenant_genre_surface_key_computed;

-- INDEX: idx_content_ranking_snapshots_tenant_leaderboard_computed
-- The leading columns name one leaderboard: its genre, surface, age rating,
-- ranking key, and entity type. Also what a genre's delete cascades through.
CREATE INDEX idx_content_ranking_snapshots_tenant_leaderboard_computed ON content_ranking_snapshots USING btree (tenant_id, genre_id, surface, age_rating, ranking_key, entity_type, computed_at DESC);
