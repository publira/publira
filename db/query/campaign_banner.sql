-- name: ListCampaignBannersForTenant :many
-- Every banner of the tenant, in the order the console put them in. The admin
-- API caps how many a tenant holds, so the list is read whole.
SELECT b.id,
    b.public_id,
    b.link_url,
    b.alt_text,
    b.starts_at,
    b.ends_at,
    b.display_order,
    b.is_published,
    b.image_id,
    bi.updated_at AS image_updated_at,
    b.created_at,
    b.updated_at
FROM campaign_banners b
    LEFT JOIN campaign_banner_images bi ON bi.id = b.image_id
WHERE b.tenant_id = $1
ORDER BY b.display_order ASC,
    b.id ASC;

-- name: GetCampaignBannerByIDForTenant :one
SELECT b.id,
    b.public_id,
    b.link_url,
    b.alt_text,
    b.starts_at,
    b.ends_at,
    b.display_order,
    b.is_published,
    b.image_id,
    bi.updated_at AS image_updated_at,
    b.created_at,
    b.updated_at
FROM campaign_banners b
    LEFT JOIN campaign_banner_images bi ON bi.id = b.image_id
WHERE b.tenant_id = $1
    AND b.id = $2
LIMIT 1;

-- name: LockCampaignBannerByIDForTenant :one
-- Serializes the image writes on one banner; the caller re-reads image_id
-- behind it.
SELECT id
FROM campaign_banners
WHERE tenant_id = $1
    AND id = $2
FOR UPDATE;

-- name: LockCampaignBannersForTenant :many
-- Locks every banner of the tenant and hands back the order they are in now,
-- so a reorder can check the client's expected order against a list no
-- concurrent write can move underneath it.
SELECT id
FROM campaign_banners
WHERE tenant_id = $1
ORDER BY display_order ASC,
    id ASC
FOR UPDATE;

-- name: LockTenantForCampaignBanners :one
-- Serializes the creates of one tenant, so two of them cannot both count one
-- short of the cap and both be stored, nor both take the same next position.
-- NO KEY UPDATE rather than UPDATE, so it does not hold back the foreign key
-- checks every write naming the tenant makes.
SELECT id
FROM tenants
WHERE id = $1
FOR NO KEY UPDATE;

-- name: CountCampaignBannersForTenant :one
SELECT COUNT(*)::int4 AS banner_count
FROM campaign_banners
WHERE tenant_id = $1;

-- name: GetMaxCampaignBannerDisplayOrderForTenant :one
-- Where a newly created banner goes: after everything that already exists.
SELECT COALESCE(MAX(display_order), 0)::int4 AS max_display_order
FROM campaign_banners
WHERE tenant_id = $1;

-- A save writes both boundary marks along with the window. The save itself
-- drops the caches the banner is held under, so a boundary it stores in the
-- past is already applied, and one it stores in the future is owed again —
-- including a boundary the ticker had applied for the window being replaced.
-- name: CreateCampaignBanner :one
INSERT INTO campaign_banners (
        id,
        tenant_id,
        public_id,
        link_url,
        alt_text,
        starts_at,
        ends_at,
        display_order,
        is_published,
        start_revalidated_at,
        end_revalidated_at
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('public_id'),
        sqlc.arg('link_url'),
        sqlc.arg('alt_text'),
        sqlc.arg('starts_at'),
        sqlc.arg('ends_at'),
        sqlc.arg('display_order'),
        sqlc.arg('is_published'),
        CASE
            WHEN sqlc.arg('starts_at')::timestamptz <= NOW() THEN NOW()
        END,
        CASE
            WHEN sqlc.arg('ends_at')::timestamptz <= NOW() THEN NOW()
        END
    )
RETURNING id,
    public_id;

-- name: UpdateCampaignBanner :exec
UPDATE campaign_banners
SET link_url = sqlc.arg('link_url'),
    alt_text = sqlc.arg('alt_text'),
    starts_at = sqlc.arg('starts_at'),
    ends_at = sqlc.arg('ends_at'),
    is_published = sqlc.arg('is_published'),
    image_id = sqlc.narg('image_id'),
    start_revalidated_at = CASE
        WHEN sqlc.arg('starts_at')::timestamptz <= NOW() THEN NOW()
    END,
    end_revalidated_at = CASE
        WHEN sqlc.arg('ends_at')::timestamptz <= NOW() THEN NOW()
    END,
    updated_at = NOW()
WHERE id = sqlc.arg('id');

-- name: SetCampaignBannerImage :exec
-- Points a banner at the upload it shows.
UPDATE campaign_banners
SET image_id = $2,
    updated_at = NOW()
WHERE id = $1;

-- name: UpdateCampaignBannerDisplayOrder :exec
UPDATE campaign_banners
SET display_order = $2
WHERE id = $1;

-- name: DeleteCampaignBanner :execrows
DELETE FROM campaign_banners
WHERE tenant_id = $1
    AND id = $2;

-- name: ListShowingCampaignBannersForTenant :many
-- The banners a storefront shows at this moment: published, with an image,
-- and with NOW() inside the half-open window, in the console's order. The
-- window is a pair of instants, so the comparison needs no time zone: the
-- tenant's own one is where the console turned the operator's dates into them.
SELECT b.id,
    b.public_id,
    b.link_url,
    b.alt_text,
    b.image_id,
    bi.updated_at AS image_updated_at
FROM campaign_banners b
    JOIN campaign_banner_images bi ON bi.id = b.image_id
WHERE b.tenant_id = $1
    AND b.is_published
    AND b.starts_at <= NOW()
    AND b.ends_at > NOW()
ORDER BY b.display_order ASC,
    b.id ASC;

-- name: ListCampaignBannerBoundariesDue :many
-- Every published banner with a boundary the ticker has not dropped the site
-- caches for yet. A banner whose start and end both passed while the ticker
-- was down comes back with both flags set, and one drop answers for both. An
-- unpublished banner is in no cached answer, and publishing it is a save that
-- drops the caches itself, so its boundaries are not owed.
--
-- This spans every tenant, so the connection must bypass RLS.
SELECT b.id,
    b.tenant_id,
    b.public_id,
    (
        b.start_revalidated_at IS NULL
        AND b.starts_at <= NOW()
    ) AS start_due,
    (
        b.end_revalidated_at IS NULL
        AND b.ends_at <= NOW()
    ) AS end_due
FROM campaign_banners b
WHERE b.is_published
    AND (
        (
            b.start_revalidated_at IS NULL
            AND b.starts_at <= NOW()
        )
        OR (
            b.end_revalidated_at IS NULL
            AND b.ends_at <= NOW()
        )
    )
ORDER BY b.tenant_id,
    b.starts_at,
    b.id;

-- The marks re-check the instant, so a banner rescheduled ahead between the
-- listing and the mark keeps its drop owed.
-- name: MarkCampaignBannerStartRevalidated :exec
UPDATE campaign_banners
SET start_revalidated_at = NOW()
WHERE id = $1
    AND start_revalidated_at IS NULL
    AND starts_at <= NOW();

-- name: MarkCampaignBannerEndRevalidated :exec
UPDATE campaign_banners
SET end_revalidated_at = NOW()
WHERE id = $1
    AND end_revalidated_at IS NULL
    AND ends_at <= NOW();
