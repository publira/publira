-- name: CreateEpisodeCampaignPrice :one
INSERT INTO episode_campaign_prices (
        id,
        tenant_id,
        public_id,
        episode_id,
        price,
        starts_at,
        ends_at,
        created_by_user_id
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id,
    tenant_id,
    public_id,
    episode_id,
    price,
    starts_at,
    ends_at,
    created_by_user_id,
    created_at;

-- name: GetEpisodeCampaignPriceByIDForTenant :one
SELECT cp.id,
    cp.public_id,
    cp.price,
    cp.starts_at,
    cp.ends_at,
    cp.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM episode_campaign_prices cp
    JOIN episodes e ON e.id = cp.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.id = e.series_id
WHERE cp.tenant_id = $1
    AND cp.id = $2
LIMIT 1;

-- Admin ListEpisodeCampaignPrices is (starts_at, id) DESC, and each scope has
-- queries of its own, for the reasons the ListEpisodeFreeWindows* queries
-- give: one page of one episode is a scan of
-- idx_episode_campaign_prices_episode_period, and a series takes at most one
-- page from each of its episodes before sorting.
-- cursor rules: proto/README.md.
-- name: ListEpisodeCampaignPricesByEpisodeForTenantDesc :many
SELECT cp.id,
    cp.public_id,
    cp.price,
    cp.starts_at,
    cp.ends_at,
    cp.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM episode_campaign_prices cp
    JOIN episodes e ON e.id = cp.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.id = e.series_id
WHERE cp.tenant_id = sqlc.arg('tenant_id')
    AND cp.episode_id = sqlc.arg('episode_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (cp.starts_at, cp.id) <= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (cp.starts_at, cp.id) < (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY cp.starts_at DESC,
    cp.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeCampaignPricesByEpisodeForTenantAsc :many
SELECT cp.id,
    cp.public_id,
    cp.price,
    cp.starts_at,
    cp.ends_at,
    cp.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM episode_campaign_prices cp
    JOIN episodes e ON e.id = cp.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.id = e.series_id
WHERE cp.tenant_id = sqlc.arg('tenant_id')
    AND cp.episode_id = sqlc.arg('episode_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (cp.starts_at, cp.id) >= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (cp.starts_at, cp.id) > (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY cp.starts_at ASC,
    cp.id ASC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeCampaignPricesBySeriesForTenantDesc :many
SELECT cp.id,
    cp.public_id,
    cp.price,
    cp.starts_at,
    cp.ends_at,
    cp.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM series s
    JOIN episodes e ON e.series_id = s.id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    CROSS JOIN LATERAL (
        SELECT c.id,
            c.public_id,
            c.price,
            c.starts_at,
            c.ends_at,
            c.created_at
        FROM episode_campaign_prices c
        WHERE c.episode_id = e.id
            AND (
                sqlc.narg('cursor_id')::uuid IS NULL
                OR (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND (c.starts_at, c.id) <= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND (c.starts_at, c.id) < (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
            )
        ORDER BY c.starts_at DESC,
            c.id DESC
        LIMIT sqlc.arg('limit')
    ) cp
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
ORDER BY cp.starts_at DESC,
    cp.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeCampaignPricesBySeriesForTenantAsc :many
SELECT cp.id,
    cp.public_id,
    cp.price,
    cp.starts_at,
    cp.ends_at,
    cp.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM series s
    JOIN episodes e ON e.series_id = s.id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    CROSS JOIN LATERAL (
        SELECT c.id,
            c.public_id,
            c.price,
            c.starts_at,
            c.ends_at,
            c.created_at
        FROM episode_campaign_prices c
        WHERE c.episode_id = e.id
            AND (
                sqlc.narg('cursor_id')::uuid IS NULL
                OR (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND (c.starts_at, c.id) >= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND (c.starts_at, c.id) > (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
            )
        ORDER BY c.starts_at ASC,
            c.id ASC
        LIMIT sqlc.arg('limit')
    ) cp
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
ORDER BY cp.starts_at ASC,
    cp.id ASC
LIMIT sqlc.arg('limit');

-- name: DeleteEpisodeCampaignPriceByIDForTenant :one
-- Returns the deleted row so a concurrent second delete is told apart from a
-- campaign that never existed. end_revalidated_at says whether
-- apply-campaign-prices has already ended the campaign on the public site.
DELETE FROM episode_campaign_prices cp
WHERE cp.tenant_id = sqlc.arg('tenant_id')
    AND cp.id = sqlc.arg('id')
RETURNING cp.id,
    cp.public_id,
    cp.episode_id,
    cp.starts_at,
    cp.ends_at,
    cp.end_revalidated_at;

-- name: ListEpisodeCampaignPriceBoundariesDue :many
-- Every campaign with a boundary the apply-campaign-prices batch has not
-- dropped the site caches for yet. A campaign whose start and end both passed
-- while the batch was down comes back with both flags set, and one
-- revalidation answers for both.
--
-- This spans every tenant, so the connection must bypass RLS.
SELECT cp.id,
    cp.tenant_id,
    e.public_id AS episode_public_id,
    (
        cp.start_revalidated_at IS NULL
        AND cp.starts_at <= NOW()
    ) AS start_due,
    (
        cp.end_revalidated_at IS NULL
        AND cp.ends_at <= NOW()
    ) AS end_due
FROM episode_campaign_prices cp
    JOIN episodes e ON e.id = cp.episode_id
WHERE (
        cp.start_revalidated_at IS NULL
        AND cp.starts_at <= NOW()
    )
    OR (
        cp.end_revalidated_at IS NULL
        AND cp.ends_at <= NOW()
    )
ORDER BY cp.starts_at ASC,
    cp.id ASC;

-- name: MarkEpisodeCampaignPriceStartRevalidated :exec
UPDATE episode_campaign_prices
SET start_revalidated_at = NOW()
WHERE id = $1
    AND start_revalidated_at IS NULL;

-- name: MarkEpisodeCampaignPriceEndRevalidated :exec
UPDATE episode_campaign_prices
SET end_revalidated_at = NOW()
WHERE id = $1
    AND end_revalidated_at IS NULL;
