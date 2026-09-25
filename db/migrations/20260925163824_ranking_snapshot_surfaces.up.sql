-- A series ranking cut for one surface — the web storefront or the mobile app —
-- admitting only the series that surface may show, so a surface's leaderboard
-- is not filled up to its item limit with series it cannot list. Episode
-- rankings are not read by surface and keep a NULL one.
--
-- The series rankings already written ranked both surfaces together, and no
-- surface describes them. They are the batch's output and are recomputed from
-- content_daily_stats by aggregate-rankings, so they go rather than being
-- filed under a surface they were not cut for.
DELETE FROM content_ranking_snapshots WHERE entity_type = 'series';

-- COLUMN: content_ranking_snapshots surface
ALTER TABLE ONLY content_ranking_snapshots
    ADD COLUMN surface text,
    ADD CONSTRAINT content_ranking_snapshots_surface_check CHECK ((surface = ANY (ARRAY['web'::text, 'app'::text]))),
    ADD CONSTRAINT content_ranking_snapshots_surface_entity_type_check CHECK ((((entity_type)::text = 'series'::text) = (surface IS NOT NULL)));

DROP INDEX idx_content_ranking_snapshots_unique;

-- INDEX: idx_content_ranking_snapshots_unique
CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version, genre_id, surface) NULLS NOT DISTINCT;

DROP INDEX idx_content_ranking_snapshots_tenant_genre_key_computed;

-- INDEX: idx_content_ranking_snapshots_tenant_genre_surface_key_computed
-- Also what a genre's delete cascades through.
CREATE INDEX idx_content_ranking_snapshots_tenant_genre_surface_key_computed ON content_ranking_snapshots USING btree (tenant_id, genre_id, surface, ranking_key, entity_type, computed_at DESC);
