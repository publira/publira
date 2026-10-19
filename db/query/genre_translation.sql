-- The names of a genre, one per locale, as the console writes them. What a
-- reader is shown is picked by genre_translation_for in the reads themselves,
-- and the console's own reads name a genre in the tenant default locale the
-- same way.

-- name: UpsertGenreTranslation :exec
-- Writes one locale's name. A locale the genre has no name in yet gets one.
INSERT INTO genre_translations (
        id,
        genre_id,
        tenant_id,
        locale,
        name
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('genre_id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('locale'),
        sqlc.arg('name')
    ) ON CONFLICT (genre_id, locale) DO
UPDATE
SET name = EXCLUDED.name,
    updated_at = NOW();

-- name: ListGenreTranslationsByGenreIDs :many
-- Oldest first within a genre, the order genre_translation_for falls back
-- through.
SELECT *
FROM genre_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND genre_id = ANY(sqlc.arg('genre_ids')::uuid[])
ORDER BY genre_id ASC,
    created_at ASC,
    id ASC;

-- name: GetGenreDefaultLocaleName :one
-- The name the slug is derived from: the one a reader in the tenant default
-- locale is shown.
SELECT gt.name
FROM genre_translation_for(sqlc.arg('genre_id')::uuid, '') gt;

-- name: CountGenreTranslations :one
SELECT COUNT(*)::int AS translation_count
FROM genre_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND genre_id = sqlc.arg('genre_id');

-- name: DeleteGenreTranslation :execrows
DELETE FROM genre_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND genre_id = sqlc.arg('genre_id')
    AND locale = sqlc.arg('locale');
