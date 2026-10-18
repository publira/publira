-- name: ListVolumesForSeries :many
-- Every volume of the series, published or not, in the order the console put
-- them in.
SELECT v.id,
    v.public_id,
    v.series_id,
    v.title,
    v.order_index,
    v.price,
    v.cover_image_id,
    vi.updated_at AS cover_image_updated_at,
    v.is_published,
    v.published_at,
    -- Whether a purchase of the volume still opens it, as
    -- VolumeHasStandingPurchase answers for one volume.
    EXISTS (
        SELECT 1
        FROM purchases p
        WHERE p.tenant_id = v.tenant_id
            AND p.volume_id = v.id
            AND p.revoked_at IS NULL
    ) AS purchased,
    v.created_at,
    v.updated_at
FROM volumes v
    LEFT JOIN volume_cover_images vi ON vi.id = v.cover_image_id
WHERE v.tenant_id = sqlc.arg('tenant_id')
    AND v.series_id = sqlc.arg('series_id')
ORDER BY v.order_index ASC,
    v.id ASC;

-- name: GetVolumeByIDForTenant :one
SELECT v.id,
    v.public_id,
    v.series_id,
    v.title,
    v.order_index,
    v.price,
    v.cover_image_id,
    vi.updated_at AS cover_image_updated_at,
    v.is_published,
    v.published_at,
    -- Whether a purchase of the volume still opens it, as
    -- VolumeHasStandingPurchase answers for one volume.
    EXISTS (
        SELECT 1
        FROM purchases p
        WHERE p.tenant_id = v.tenant_id
            AND p.volume_id = v.id
            AND p.revoked_at IS NULL
    ) AS purchased,
    v.created_at,
    v.updated_at
FROM volumes v
    LEFT JOIN volume_cover_images vi ON vi.id = v.cover_image_id
WHERE v.tenant_id = sqlc.arg('tenant_id')
    AND v.id = sqlc.arg('id');

-- name: LockVolumeByIDForTenant :one
-- Serializes the writes on one volume and answers its series, whose row the
-- writes that move episodes between volumes lock first; the caller re-reads
-- the volume behind it.
SELECT id,
    series_id
FROM volumes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR UPDATE;

-- name: LockVolumesForSeries :many
-- Locks every volume of the series and hands back the order they are in now,
-- so a reorder can check the client's expected order against a list no
-- concurrent write can move underneath it.
SELECT id
FROM volumes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id')
ORDER BY order_index ASC,
    id ASC
FOR UPDATE;

-- name: CountVolumesForSeries :one
SELECT COUNT(*)::int4 AS volume_count
FROM volumes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id');

-- name: GetMaxVolumeOrderIndexForSeries :one
-- Where a newly created volume goes: after every volume the series has.
SELECT COALESCE(MAX(order_index), -1)::int4 AS max_order_index
FROM volumes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id');

-- name: CreateVolume :one
INSERT INTO volumes (
        id,
        tenant_id,
        public_id,
        series_id,
        title,
        order_index,
        price
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('public_id'),
        sqlc.arg('series_id'),
        sqlc.arg('title'),
        sqlc.arg('order_index'),
        sqlc.arg('price')
    )
RETURNING id,
    public_id;

-- name: UpdateVolume :exec
-- Replaces the title and the price. A purchase already made keeps the price it
-- was made at, and a checkout already started the one it was started at.
UPDATE volumes
SET title = sqlc.arg('title'),
    price = sqlc.arg('price'),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: SetVolumePublished :exec
-- Puts the volume on sale or takes it off. Publishing a volume already on sale
-- keeps the instant it was put on sale.
UPDATE volumes
SET is_published = sqlc.arg('is_published')::boolean,
    published_at = CASE
        WHEN sqlc.arg('is_published')::boolean THEN COALESCE(published_at, NOW())
    END,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: UpdateVolumeOrderIndex :exec
UPDATE volumes
SET order_index = sqlc.arg('order_index')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: SetVolumeCoverImageID :exec
-- Points the volume at an uploaded cover, or at none. The cover it pointed at
-- before is left for the orphan image sweep.
UPDATE volumes
SET cover_image_id = sqlc.narg('cover_image_id'),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: ListVolumeEpisodesByVolumeIDs :many
-- The episodes of each listed volume, in each volume's own order.
SELECT volume_id,
    episode_id
FROM volume_episodes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND volume_id = ANY(sqlc.arg('volume_ids')::uuid[])
ORDER BY volume_id,
    "position";

-- name: CountSeriesEpisodesByIDs :one
-- How many of the listed episodes belong to the series. An assignment naming
-- an episode of another series, or none at all, counts short.
SELECT COUNT(*)::int4 AS episode_count
FROM episodes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id')
    AND id = ANY(sqlc.arg('episode_ids')::uuid[]);

-- name: CountEpisodesInOtherVolumes :one
-- How many of the listed episodes another volume already holds. An episode is
-- in at most one volume, so an assignment has to take it out of the other
-- volume first.
SELECT COUNT(*)::int4 AS episode_count
FROM volume_episodes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND volume_id <> sqlc.arg('volume_id')
    AND episode_id = ANY(sqlc.arg('episode_ids')::uuid[]);

-- name: VolumeHasStandingPurchase :one
-- Whether a purchase of the volume still opens its episodes: one neither
-- refunded in full, disputed, nor revoked by staff. Such a buyer paid for the
-- episodes the volume holds, so none of them may leave it.
SELECT EXISTS (
        SELECT 1
        FROM purchases
        WHERE tenant_id = sqlc.arg('tenant_id')
            AND volume_id = sqlc.arg('volume_id')::uuid
            AND revoked_at IS NULL
    );

-- name: DeleteVolumeEpisodes :exec
DELETE FROM volume_episodes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND volume_id = sqlc.arg('volume_id');

-- name: InsertVolumeEpisodes :exec
-- Writes the volume's episodes in the order given, the first at position 0.
INSERT INTO volume_episodes (
        tenant_id,
        volume_id,
        episode_id,
        "position"
    )
SELECT sqlc.arg('tenant_id'),
    sqlc.arg('volume_id'),
    e.episode_id,
    (e.ordinality - 1)::int4
FROM unnest(sqlc.arg('episode_ids')::uuid[]) WITH ORDINALITY AS e(episode_id, ordinality);

-- name: ListPublishedVolumesForSeries :many
-- The volumes of the series on sale, in the console's order. Which of their
-- episodes a surface shows is the caller's to decide, since it holds the
-- series' episodes as that surface lists them.
SELECT v.id,
    v.public_id,
    v.title,
    v.order_index,
    v.price,
    v.cover_image_id,
    vi.updated_at AS cover_image_updated_at,
    v.published_at
FROM volumes v
    LEFT JOIN volume_cover_images vi ON vi.id = v.cover_image_id
WHERE v.tenant_id = sqlc.arg('tenant_id')
    AND v.series_id = sqlc.arg('series_id')
    AND v.is_published
ORDER BY v.order_index ASC,
    v.id ASC;
