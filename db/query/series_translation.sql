-- The translations of a series, one per locale, as the console writes them.
-- What a reader is shown is picked by series_translation_for in the reads
-- themselves.

-- name: UpsertSeriesTranslation :one
-- Writes one locale's title, and its synopsis when write_synopsis says the
-- save stated one. A locale the series has no translation in yet gets one,
-- with an empty synopsis where none was stated.
INSERT INTO series_translations (
        id,
        series_id,
        tenant_id,
        locale,
        title,
        synopsis
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('series_id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('locale'),
        sqlc.arg('title'),
        sqlc.arg('synopsis')
    ) ON CONFLICT (series_id, locale) DO
UPDATE
SET title = EXCLUDED.title,
    synopsis = CASE
        WHEN sqlc.arg('write_synopsis')::boolean THEN EXCLUDED.synopsis
        ELSE series_translations.synopsis
    END,
    updated_at = NOW()
RETURNING *;

-- name: ListSeriesTranslationsForTenant :many
-- Oldest first, the order series_translation_for falls back through.
SELECT *
FROM series_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id')
ORDER BY created_at ASC,
    id ASC;

-- name: CountSeriesTranslations :one
SELECT COUNT(*)::int AS translation_count
FROM series_translations
WHERE series_id = $1;

-- name: DeleteSeriesTranslation :execrows
DELETE FROM series_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id')
    AND locale = sqlc.arg('locale');

-- name: TouchSeriesUpdatedAt :exec
-- A deleted translation changes what the series page shows in its locale,
-- and the sitemap's last_modified_at reads that from series.updated_at, which
-- every other write to a translation moves through UpdateSeriesBase.
UPDATE series
SET updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');
