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

-- name: MarkEpisodePublished :execrows
-- The scheduled publication job's promotion of an episode it listed as due.
-- The job lists before it publishes, so the listing is matched again here: one
-- the console published, took back to a draft, or moved later in between
-- counts no row and is left as the console saved it.
UPDATE episode_listings
SET status = 'published',
    published_at = NOW()
WHERE episode_id = $1
    AND status = 'scheduled'
    AND scheduled_at <= NOW();

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

-- name: MarkEpisodeAnnounced :exec
-- The follower fan-out's record that it told the episode's followers, written
-- only when a reader can open the episode now: the same rule
-- ListEpisodeFollowerIDs gates the fan-out on, read from the same view. An
-- episode the fan-out answered nobody for is left unannounced, so publishing
-- its series later announces it then. A second fan-out over the same episode
-- keeps the first one's time.
UPDATE episode_listings el
SET announced_at = NOW()
WHERE el.tenant_id = sqlc.arg('tenant_id')
    AND el.episode_id = sqlc.arg('episode_id')
    AND el.announced_at IS NULL
    AND EXISTS (
        SELECT 1
        FROM published_episode_surfaces pes
        WHERE pes.tenant_id = sqlc.arg('tenant_id')
            AND pes.episode_id = sqlc.arg('episode_id')
    );

-- name: RedateEpisodesForSeriesPublication :many
-- The episodes a series becoming public owes an announcement: published while
-- it was not, so their followers were never told, and open to a reader now.
-- Each is dated from the series' publication instant, because no reader could
-- open it before then, unless its own publication came later still, as it
-- does under a series saved with an instant in the past.
--
-- The answer is the episodes the caller queues an announcement for, with the
-- instant that names this publication of the series. An episode already
-- announced while the series was public before is not among them and keeps
-- its date. A series that is not public yet answers no row, and the
-- apply-series-publications job asks again once its instant has passed.
UPDATE episode_listings el
SET published_at = GREATEST(el.published_at, s.published_at)
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
    AND el.tenant_id = s.tenant_id
    AND el.announced_at IS NULL
    AND el.episode_id IN (
        SELECT pes.episode_id
        FROM published_episode_surfaces pes
        WHERE pes.tenant_id = sqlc.arg('tenant_id')
            AND pes.series_id = sqlc.arg('series_id')
    )
RETURNING el.episode_id,
    s.published_at::timestamptz AS series_published_at;
