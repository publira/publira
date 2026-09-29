-- A ranking of one genre's series, filed beside the tenant-wide one. A NULL
-- genre_id is the tenant-wide ranking, so the ranking keys, the retention
-- purge, and the paging by snapshot id all apply to a genre's ranking as they
-- are.
--
-- The indexes are rebuilt in this file rather than concurrently: the daily
-- ranking batch is the table's only writer, and retention keeps it small.
ALTER TABLE ONLY content_ranking_snapshots
    ADD COLUMN genre_id uuid,
    ADD CONSTRAINT content_ranking_snapshots_genre_entity_type_check CHECK (((genre_id IS NULL) OR ((entity_type)::text = 'series'::text)));

-- FK CONSTRAINT: content_ranking_snapshots content_ranking_snapshots_tenant_genre_id_fkey
-- A genre deleted in the console takes its rankings with it.
ALTER TABLE ONLY content_ranking_snapshots
    ADD CONSTRAINT content_ranking_snapshots_tenant_genre_id_fkey FOREIGN KEY (tenant_id, genre_id) REFERENCES genres(tenant_id, id) ON DELETE CASCADE;

DROP INDEX idx_content_ranking_snapshots_unique;

-- INDEX: idx_content_ranking_snapshots_unique
-- NULLS NOT DISTINCT keeps a re-run of the tenant-wide ranking replacing its
-- row rather than adding a second one.
CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version, genre_id) NULLS NOT DISTINCT;

DROP INDEX idx_content_ranking_snapshots_tenant_key_computed;

-- INDEX: idx_content_ranking_snapshots_tenant_genre_key_computed
-- Also what a genre's delete cascades through.
CREATE INDEX idx_content_ranking_snapshots_tenant_genre_key_computed ON content_ranking_snapshots USING btree (tenant_id, genre_id, ranking_key, entity_type, computed_at DESC);
