-- The translations of an episode, one per locale, as the console writes them.
-- What a reader is shown is picked by episode_translation_for in the reads
-- themselves.

-- name: UpsertEpisodeTranslation :one
INSERT INTO episode_translations (
        id,
        episode_id,
        tenant_id,
        locale,
        title
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('episode_id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('locale'),
        sqlc.arg('title')
    ) ON CONFLICT (episode_id, locale) DO
UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW()
RETURNING *;

-- name: ListEpisodeTranslationsForTenant :many
-- Oldest first, the order episode_translation_for falls back through.
SELECT *
FROM episode_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id')
ORDER BY created_at ASC,
    id ASC;

-- name: CountEpisodeTranslations :one
SELECT COUNT(*)::int AS translation_count
FROM episode_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id');

-- name: DeleteEpisodeTranslation :execrows
DELETE FROM episode_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id')
    AND locale = sqlc.arg('locale');
