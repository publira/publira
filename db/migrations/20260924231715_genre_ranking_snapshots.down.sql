-- The genre rankings go first: without genre_id they would collide with the
-- tenant-wide ranking of the same period on the restored unique index.
DELETE FROM content_ranking_snapshots WHERE genre_id IS NOT NULL;

DROP INDEX idx_content_ranking_snapshots_tenant_genre_key_computed;

CREATE INDEX idx_content_ranking_snapshots_tenant_key_computed ON content_ranking_snapshots USING btree (tenant_id, ranking_key, entity_type, computed_at DESC);

DROP INDEX idx_content_ranking_snapshots_unique;

CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version);

ALTER TABLE ONLY content_ranking_snapshots
    DROP CONSTRAINT content_ranking_snapshots_tenant_genre_id_fkey,
    DROP CONSTRAINT content_ranking_snapshots_genre_entity_type_check,
    DROP COLUMN genre_id;
