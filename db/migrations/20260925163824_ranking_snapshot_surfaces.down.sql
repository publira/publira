-- The app's rankings go first: without surface they would collide with the
-- web's ranking of the same period on the restored unique index.
DELETE FROM content_ranking_snapshots WHERE surface = 'app';

DROP INDEX idx_content_ranking_snapshots_tenant_genre_surface_key_computed;

CREATE INDEX idx_content_ranking_snapshots_tenant_genre_key_computed ON content_ranking_snapshots USING btree (tenant_id, genre_id, ranking_key, entity_type, computed_at DESC);

DROP INDEX idx_content_ranking_snapshots_unique;

CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version, genre_id) NULLS NOT DISTINCT;

ALTER TABLE ONLY content_ranking_snapshots
    DROP CONSTRAINT content_ranking_snapshots_surface_entity_type_check,
    DROP CONSTRAINT content_ranking_snapshots_surface_check,
    DROP COLUMN surface;
