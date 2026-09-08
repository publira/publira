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
