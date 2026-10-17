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

-- name: TouchEpisodeTranslationDeletedAt :exec
-- A deleted translation changes what the episode page shows in its locale,
-- and the sitemap's last_modified_at reads that from
-- episodes.translation_deleted_at, as it reads every other write to a
-- translation from the translation's own updated_at.
UPDATE episodes
SET translation_deleted_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');
