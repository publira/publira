-- Orphan image reclamation (publiractl job purge-orphan-images).
--
-- Every image this repository stores lives in two places: an `*_images` row
-- with its `*_image_variants` children, and one object per variant in the S3
-- compatible bucket. The database is the authority — an object nothing in
-- these tables names is garbage — so reclamation runs in that order: drop the
-- image rows no entity points at any more, then delete the objects no variant
-- row is left naming.
--
-- episode_images has no unreferenced state and so no delete here: an episode
-- owns every image filed under it, and there is no column that elects one of
-- them, so a row that exists is a row in use.
--
-- reader_icon_presets has none either: a preset is the tenant's for as long as
-- its row exists, whether or not any account shows it, and staff deleting it
-- is what leaves its objects to the sweep.
--
-- Expected plans (empty table may still seq-scan; SET enable_seqscan = off
-- in the integration test to confirm the index is eligible):
--   ListReferencedObjectKeys
--     -> idx_<entity>_image_variants_object_key, once per variant table
--   DeleteUnreferencedCampaignBannerImages / ...CreatorImages /
--   ...EpisodeEyeCatchImages / ...GenreImages / ...LabelImages /
--   ...SeriesImages / ...TenantImages / ...VolumeCoverImages
--     -> no index; one anti-join per run over a table that holds one row per
--        entity image
--   DeleteUnreferencedUserImages
--     -> idx_users_tenant_id_icon_image_id, once per user_images row: users
--        holds every reader, so the anti-join is a lookup rather than a scan

-- name: ListReferencedObjectKeys :many
-- Returns the subset of object_keys that some image variant still names. The
-- caller deletes what it listed from storage and did not get back, so a key
-- this misses is a deleted live object: every table that holds an object_key
-- has to be listed here.
WITH candidates AS (
    SELECT unnest(@object_keys::text[]) AS object_key
)
SELECT c.object_key::text
FROM candidates c
WHERE EXISTS (SELECT 1 FROM tenant_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM series_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM label_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM genre_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM campaign_banner_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM creator_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM episode_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM episode_eye_catch_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM user_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM volume_cover_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM reader_icon_preset_variants v WHERE v.object_key = c.object_key);

-- name: DeleteUnreferencedCampaignBannerImages :execrows
-- A replaced banner image is left behind by the banner that now points at the
-- new upload; deleting the banner takes its images with it.
DELETE FROM campaign_banner_images bi
WHERE bi.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM campaign_banners b WHERE b.image_id = bi.id);

-- name: DeleteUnreferencedCreatorImages :execrows
-- An upload points its creator at the new icon and leaves the previous
-- creator_images row behind, referenced by nothing. created_at guards the
-- upload still in flight, whose row exists before the creator names it.
DELETE FROM creator_images ci
WHERE ci.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM creators c WHERE c.icon_image_id = ci.id);

-- name: DeleteUnreferencedEpisodeEyeCatchImages :execrows
DELETE FROM episode_eye_catch_images ei
WHERE ei.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.eye_catch_image_id = ei.id);

-- name: DeleteUnreferencedGenreImages :execrows
DELETE FROM genre_images gi
WHERE gi.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM genres g WHERE g.eye_catch_image_id = gi.id);

-- name: DeleteUnreferencedLabelImages :execrows
DELETE FROM label_images li
WHERE li.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.eye_catch_image_id = li.id);

-- name: DeleteUnreferencedSeriesImages :execrows
DELETE FROM series_images si
WHERE si.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM series s WHERE s.eye_catch_image_id = si.id);

-- name: DeleteUnreferencedTenantImages :execrows
-- A tenant image is reachable from any of the branding slots the theme holds,
-- or as the image of one of the tenant's brand marks.
DELETE FROM tenant_images ti
WHERE ti.created_at < @created_before
    AND NOT EXISTS (
        SELECT 1 FROM tenant_themes t
        WHERE t.icon_image_id = ti.id
            OR t.logo_image_id = ti.id
            OR t.sign_in_image_id = ti.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM tenant_brand_marks bm
        WHERE bm.tenant_id = ti.tenant_id
            AND bm.image_id = ti.id
    );

-- name: DeleteUnreferencedUserImages :execrows
-- A reader's upload elects the new icon and leaves the previous user_images
-- row behind, and removing the icon leaves the one it cleared, both referenced
-- by nothing. created_at guards the upload still in flight, whose row exists
-- before the account elects it.
DELETE FROM user_images ui
WHERE ui.created_at < @created_before
    AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.tenant_id = ui.tenant_id AND u.icon_image_id = ui.id
    );

-- name: DeleteUnreferencedVolumeCoverImages :execrows
-- A replaced or removed cover is left behind by the volume that no longer
-- points at it.
DELETE FROM volume_cover_images vi
WHERE vi.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM volumes v WHERE v.cover_image_id = vi.id);
