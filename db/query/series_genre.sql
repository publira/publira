-- name: ListSeriesGenresBySeriesIDs :many
-- Genres read back in the tenant's own genre order rather than the order they
-- were assigned in, so every series presents them the same way the genre list
-- does, each named in the tenant default locale as the console's genre list
-- names it.
SELECT sg.series_id,
    g.id AS genre_id,
    g.public_id,
    gt.name,
    g.slug
FROM series_genres sg
    JOIN genres g ON g.id = sg.genre_id
    CROSS JOIN LATERAL genre_translation_for(g.id, '') gt
WHERE sg.series_id = ANY(sqlc.arg('series_ids')::uuid[])
ORDER BY sg.series_id ASC,
    g.display_order ASC,
    g.id ASC;

-- name: CreateSeriesGenre :exec
INSERT INTO series_genres (
        tenant_id,
        series_id,
        genre_id
    )
VALUES ($1, $2, $3);

-- name: DeleteSeriesGenresBySeriesID :exec
DELETE FROM series_genres
WHERE series_id = $1;
