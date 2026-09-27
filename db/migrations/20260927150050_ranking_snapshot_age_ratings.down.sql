-- The tenant-wide rankings of one rating go first: without age_rating they
-- would collide with the mixed ranking of the same period on the restored
-- unique index.
DELETE FROM content_ranking_snapshots WHERE genre_id IS NULL AND age_rating IS NOT NULL;

DROP INDEX idx_content_ranking_snapshots_tenant_leaderboard_computed;

CREATE INDEX idx_content_ranking_snapshots_tenant_genre_surface_key_computed ON content_ranking_snapshots USING btree (tenant_id, genre_id, surface, ranking_key, entity_type, computed_at DESC);

DROP INDEX idx_content_ranking_snapshots_unique;

CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version, genre_id, surface) NULLS NOT DISTINCT;

ALTER TABLE ONLY content_ranking_snapshots
    DROP CONSTRAINT content_ranking_snapshots_age_rating_genre_check,
    DROP CONSTRAINT content_ranking_snapshots_age_rating_entity_type_check,
    DROP CONSTRAINT content_ranking_snapshots_age_rating_check,
    DROP COLUMN age_rating;
