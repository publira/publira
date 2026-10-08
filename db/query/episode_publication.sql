-- name: ListEpisodesReadyToPublish :many
SELECT el.episode_id
FROM episode_listings el
WHERE el.status = 'scheduled'
    AND el.scheduled_at IS NOT NULL
    AND el.scheduled_at <= NOW();

-- name: ListEpisodesReadyToPublishWithTenantInfo :many
SELECT el.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id,
    s.title AS series_title,
    t.id AS tenant_id,
    t.public_id AS tenant_public_id,
    t.name AS tenant_name,
    t.domain AS tenant_domain
FROM episode_listings el
    JOIN episodes e ON e.id = el.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN tenants t ON t.id = el.tenant_id
WHERE el.status = 'scheduled'
    AND el.scheduled_at IS NOT NULL
    AND el.scheduled_at <= NOW();

-- name: GetPublishedEpisodeForFollowerNotification :one
-- Worker read: what the episode_published notification of an episode the
-- console published at once says. An episode that is no longer published by
-- the time the event drains answers no row, so its followers are not told.
SELECT e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE e.tenant_id = $1
    AND e.id = $2
    AND el.status = 'published';

-- name: MarkEpisodePublished :exec
UPDATE episode_listings
SET status = 'published',
    published_at = NOW()
WHERE episode_id = $1;

-- name: UpdateEpisodePublishScheduleByIDForTenant :exec
UPDATE episode_listings el
SET status = CASE
        WHEN sqlc.narg('scheduled_at')::timestamptz IS NULL THEN 'draft'
        ELSE 'scheduled'
    END,
    scheduled_at = sqlc.narg('scheduled_at')::timestamptz,
    published_at = CASE
        WHEN sqlc.narg('scheduled_at')::timestamptz IS NULL THEN NULL
        ELSE el.published_at
    END
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE el.episode_id = e.id
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id');

-- name: PublishEpisodeNowByIDForTenant :execrows
-- The console's publication of an episode given a time that has already
-- passed: what MarkEpisodePublished does once the time is reached, done in the
-- write that saves it. An episode already published is left as it is, its
-- published_at included, so it counts no row, as an id naming no episode does;
-- the count is what tells the caller its followers have news.
UPDATE episode_listings el
SET status = 'published',
    scheduled_at = sqlc.arg('scheduled_at')::timestamptz,
    published_at = NOW()
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE el.episode_id = e.id
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id')
    AND el.status <> 'published';
