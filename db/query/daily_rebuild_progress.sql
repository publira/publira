-- name: ListDailyRebuildProgress :many
SELECT tenant_id, episode_reads_projected_at, content_stats_through, rankings_through, recommend_features_through
FROM daily_rebuild_progress
ORDER BY tenant_id;

-- RecordEpisodeReadProjection moves a tenant's projection instant forward, and
-- starts the chain for a tenant it has not seen yet: every link is placed on
-- start_through, so the first day each one rebuilds is the day after it.
-- name: RecordEpisodeReadProjection :exec
INSERT INTO daily_rebuild_progress (
    tenant_id, episode_reads_projected_at, content_stats_through, rankings_through, recommend_features_through
) VALUES (
    sqlc.arg(tenant_id), sqlc.arg(projected_at), sqlc.arg(start_through), sqlc.arg(start_through), sqlc.arg(start_through)
)
ON CONFLICT (tenant_id) DO UPDATE
SET episode_reads_projected_at = GREATEST(daily_rebuild_progress.episode_reads_projected_at, EXCLUDED.episode_reads_projected_at),
    updated_at = now();

-- The three advances below never move a link back, so a pass that finished
-- behind another cannot undo what the other recorded.

-- name: AdvanceContentStatsThrough :exec
UPDATE daily_rebuild_progress
SET content_stats_through = sqlc.arg(through), updated_at = now()
WHERE tenant_id = sqlc.arg(tenant_id) AND content_stats_through < sqlc.arg(through);

-- name: AdvanceRankingsThrough :exec
UPDATE daily_rebuild_progress
SET rankings_through = sqlc.arg(through), updated_at = now()
WHERE tenant_id = sqlc.arg(tenant_id) AND rankings_through < sqlc.arg(through);

-- name: AdvanceRecommendFeaturesThrough :exec
UPDATE daily_rebuild_progress
SET recommend_features_through = sqlc.arg(through), updated_at = now()
WHERE tenant_id = sqlc.arg(tenant_id) AND recommend_features_through < sqlc.arg(through);
