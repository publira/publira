-- name: UpsertTagForTenant :one
-- Resolves one tag name the series form carried, creating the tag when this is
-- its first use.
--
-- The update is deliberately a no-op that keeps the stored name: ON CONFLICT
-- DO NOTHING returns no row, and the insert has to hand back the tag either
-- way. Keeping the stored name is also the answer to "fantasy" typed under a
-- tag saved as "Fantasy" — the slug says they are the same tag, and the name
-- the tenant first wrote is the one every other series keeps showing.
INSERT INTO tags (
        id,
        tenant_id,
        name,
        slug
    )
VALUES ($1, $2, $3, $4)
ON CONFLICT (tenant_id, slug) DO UPDATE
SET name = tags.name
RETURNING *;

-- Removing the tags a save let go of takes two statements, because one cannot
-- be trusted on its own.
--
-- A single DELETE decides what is unused from the snapshot it started with. A
-- save committing in another session between that snapshot and the row lock is
-- invisible to it, and READ COMMITTED re-checks the deleted row against the
-- same snapshot once the lock is granted — so the tag that save had just taken
-- would be deleted anyway, and the assignment with it.
--
-- Locking first is what closes that window. A row locked FOR UPDATE cannot be
-- referenced by a concurrent insert into series_tags, whose foreign key wants a
-- key share on it, so nothing can take the tag from here on. The delete is then
-- a second statement, and a second statement in READ COMMITTED reads a fresh
-- snapshot: a save that committed while the lock was being waited for is
-- visible to it, and the tag it took stays.

-- name: LockUnusedTagsForTenant :many
-- Candidates for the sweep: the tags of this tenant no series carries. Locked
-- in id order so two saves sweeping at once queue up rather than deadlock.
SELECT t.id
FROM tags t
WHERE t.tenant_id = $1
    AND NOT EXISTS (
        SELECT 1
        FROM series_tags st
        WHERE st.tag_id = t.id
    )
ORDER BY t.id
FOR UPDATE;

-- name: DeleteUnusedTagsByIDsForTenant :exec
-- Deletes the candidates that are still unused. A tag has no management screen
-- and nothing else to say for itself, so one no series carries is not a tag the
-- tenant kept — it is one nobody would ever see again.
DELETE FROM tags t
WHERE t.tenant_id = sqlc.arg('tenant_id')
    AND t.id = ANY(sqlc.arg('ids')::uuid[])
    AND NOT EXISTS (
        SELECT 1
        FROM series_tags st
        WHERE st.tag_id = t.id
    );

-- The public tag list: the tags at least one published series carries, the
-- most-carried first. A tag no published series carries is not listed — a tag
-- exists because a series carries it, so one nothing published carries has no
-- page to keep working, which is where it differs from a genre.
--
-- No index can serve this order. Its first sort key is a count the query
-- itself groups, the way ListEpisodeReadThroughDesc sorts by an aggregate of
-- its own; the scan is bounded by one tenant's assignments, which
-- idx_series_tags_tenant_tag narrows first.
--
-- (published_series_count, slug) is unique because slug is unique within the
-- tenant, so the keyset scan can neither skip nor repeat a tag two of them
-- tie on. The two keys run in opposite directions, so the comparison is
-- spelled out rather than written as a row value.
-- cursor rules: proto/README.md.
-- name: ListPublishedTagsByTenantDesc :many
WITH counted AS (
    SELECT t.name,
        t.slug,
        COUNT(*)::int4 AS published_series_count
    FROM tags t
        JOIN series_tags st ON st.tag_id = t.id
        JOIN series s ON s.id = st.series_id
    WHERE t.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
    GROUP BY t.id,
        t.name,
        t.slug
)
SELECT name,
    slug,
    published_series_count
FROM counted
WHERE (
        sqlc.narg('cursor_slug')::text IS NULL
        OR published_series_count < sqlc.narg('cursor_published_series_count')::int4
        OR (
            published_series_count = sqlc.narg('cursor_published_series_count')::int4
            AND (
                (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND slug >= sqlc.narg('cursor_slug')::text
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND slug > sqlc.narg('cursor_slug')::text
                )
            )
        )
    )
ORDER BY published_series_count DESC,
    slug ASC
LIMIT sqlc.arg('limit');

-- ListPublishedTagsByTenantDesc walked the other way. It exists only to build
-- a previous page; the order it describes is the same one.
-- name: ListPublishedTagsByTenantAsc :many
WITH counted AS (
    SELECT t.name,
        t.slug,
        COUNT(*)::int4 AS published_series_count
    FROM tags t
        JOIN series_tags st ON st.tag_id = t.id
        JOIN series s ON s.id = st.series_id
    WHERE t.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
    GROUP BY t.id,
        t.name,
        t.slug
)
SELECT name,
    slug,
    published_series_count
FROM counted
WHERE (
        sqlc.narg('cursor_slug')::text IS NULL
        OR published_series_count > sqlc.narg('cursor_published_series_count')::int4
        OR (
            published_series_count = sqlc.narg('cursor_published_series_count')::int4
            AND (
                (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND slug <= sqlc.narg('cursor_slug')::text
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND slug < sqlc.narg('cursor_slug')::text
                )
            )
        )
    )
ORDER BY published_series_count ASC,
    slug DESC
LIMIT sqlc.arg('limit');

-- name: GetTagBySlugForTenant :one
-- Whether a slug the series list was filtered by names a tag of this tenant.
-- A filter naming nothing is refused rather than answered with an empty list,
-- for the reason GetGenreIDByPublicIDForTenant gives.
SELECT t.id
FROM tags t
WHERE t.tenant_id = $1
    AND t.slug = $2
LIMIT 1;
