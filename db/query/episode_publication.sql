-- name: ListEpisodesReadyToPublish :many
SELECT el.episode_id
FROM episode_listings el
WHERE el.status = 'scheduled'
    AND el.scheduled_at IS NOT NULL
    AND el.scheduled_at <= NOW();

-- name: ListEpisodesReadyToPublishWithTenantInfo :many
SELECT el.episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id,
    str.title AS series_title,
    t.id AS tenant_id,
    t.public_id AS tenant_public_id,
    t.name AS tenant_name,
    t.domain AS tenant_domain
FROM episode_listings el
    JOIN episodes e ON e.id = el.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, '') str
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
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title
FROM episodes e
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, '') str
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
-- Taking the episode off the site settles what it owed: no reader can open it,
-- and the publication that puts it back owes its own announcement if its
-- series is still not public then.
UPDATE episode_listings el
SET status = CASE
        WHEN sqlc.narg('scheduled_at')::timestamptz IS NULL THEN 'draft'
        ELSE 'scheduled'
    END,
    scheduled_at = sqlc.narg('scheduled_at')::timestamptz,
    published_at = CASE
        WHEN sqlc.narg('scheduled_at')::timestamptz IS NULL THEN NULL
        ELSE el.published_at
    END,
    announcement_owed = false
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

-- name: OweEpisodeAnnouncementWhileSeriesHidden :exec
-- Run in the transaction that publishes the episode, by the scheduled
-- publication job and by the console alike: an episode published while its
-- series is not public owes its followers the announcement the fan-out cannot
-- make yet, and publishing the series later makes it. Recorded with the
-- publication rather than by the fan-out that drains after it, so a series
-- published in between still finds the debt.
--
-- Only a series that is not public owes one. An episode published into a
-- public series but shown on no surface is not announced later when it is
-- shown, so it owes nothing.
UPDATE episode_listings el
SET announcement_owed = true
FROM episodes e
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE el.tenant_id = sqlc.arg('tenant_id')
    AND el.episode_id = sqlc.arg('episode_id')
    AND e.tenant_id = el.tenant_id
    AND e.id = el.episode_id
    AND el.status = 'published'
    AND NOT (
        s.is_published
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
    );

-- name: RedateEpisodesForSeriesPublication :many
-- The episodes a series becoming public owes an announcement: published while
-- no reader could open them, so their followers were never told, and open to a
-- reader now. Each is dated from the series' publication instant, because no
-- reader could open it before then, unless its own publication came later
-- still, as it does under a series saved with an instant in the past.
--
-- The answer is the episodes the caller queues an announcement for, with the
-- instant that names this publication of the series; the caller then clears
-- what they owed with ClearEpisodeAnnouncementsOwed. Until it does, a second
-- run dates them to the same instant and answers them again, so a caller that
-- failed in between is retried in full. An episode already announced while the
-- series was public before owes nothing, so it is not among them and keeps its
-- date. A series that is not public yet answers no row, and the
-- apply-series-publications job asks again once its instant has passed.
UPDATE episode_listings el
SET published_at = GREATEST(el.published_at, s.published_at)
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
    AND el.tenant_id = s.tenant_id
    AND el.announcement_owed
    AND el.episode_id IN (
        SELECT pes.episode_id
        FROM published_episode_surfaces pes
        WHERE pes.tenant_id = sqlc.arg('tenant_id')
            AND pes.series_id = sqlc.arg('series_id')
    )
RETURNING el.episode_id,
    s.published_at::timestamptz AS series_published_at;

-- name: ClearEpisodeAnnouncementsOwed :exec
-- The episodes RedateEpisodesForSeriesPublication answered, once their
-- announcements are queued: the outbox owns them from there.
UPDATE episode_listings
SET announcement_owed = false
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = ANY(sqlc.arg('episode_ids')::uuid[]);

-- name: ListEpisodesByPublicationTimeForTenantAsc :many
-- The console's publishing schedule: every episode of the tenant, across its
-- series, whose publication falls in [from_time, to_time). A scheduled episode
-- is placed at the time it is to be published, and a published one at the
-- time it was, which is later than the time it was scheduled for when the
-- worker reached it late.
--
-- The list is (publication time, id) ascending; the id is the UUIDv7 that
-- keeps episodes published at one instant in creation order. The Desc query
-- reads the page before a token, and the handler flips its rows back. Cursor
-- rules: proto/README.md.
SELECT e.id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title,
    el.status,
    pt.published_at::timestamptz AS published_at
FROM episode_listings el
    CROSS JOIN LATERAL (
        SELECT CASE
                WHEN el.status = 'published' THEN el.published_at
                ELSE el.scheduled_at
            END AS published_at
    ) pt
    JOIN episodes e ON e.tenant_id = el.tenant_id
        AND e.id = el.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, '') str
WHERE el.tenant_id = sqlc.arg('tenant_id')
    AND el.status IN ('scheduled', 'published')
    AND pt.published_at >= sqlc.arg('from_time')::timestamptz
    AND pt.published_at < sqlc.arg('to_time')::timestamptz
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pt.published_at, e.id) >= (sqlc.narg('cursor_published_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pt.published_at, e.id) > (sqlc.narg('cursor_published_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY pt.published_at ASC,
    e.id ASC
LIMIT sqlc.arg('limit');

-- name: ListEpisodesByPublicationTimeForTenantDesc :many
-- ListEpisodesByPublicationTimeForTenantAsc read backwards from a token.
SELECT e.id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title,
    el.status,
    pt.published_at::timestamptz AS published_at
FROM episode_listings el
    CROSS JOIN LATERAL (
        SELECT CASE
                WHEN el.status = 'published' THEN el.published_at
                ELSE el.scheduled_at
            END AS published_at
    ) pt
    JOIN episodes e ON e.tenant_id = el.tenant_id
        AND e.id = el.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, '') str
WHERE el.tenant_id = sqlc.arg('tenant_id')
    AND el.status IN ('scheduled', 'published')
    AND pt.published_at >= sqlc.arg('from_time')::timestamptz
    AND pt.published_at < sqlc.arg('to_time')::timestamptz
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pt.published_at, e.id) <= (sqlc.narg('cursor_published_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pt.published_at, e.id) < (sqlc.narg('cursor_published_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY pt.published_at DESC,
    e.id DESC
LIMIT sqlc.arg('limit');
