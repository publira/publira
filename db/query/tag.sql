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

-- name: DeleteUnusedTagsForTenant :exec
-- Removes the tags the last series carrying them just let go of. A tag has no
-- management screen and nothing else to say for itself, so one no series
-- carries is not a tag the tenant kept — it is one nobody would ever see
-- again.
DELETE FROM tags t
WHERE t.tenant_id = $1
    AND NOT EXISTS (
        SELECT 1
        FROM series_tags st
        WHERE st.tag_id = t.id
    );
