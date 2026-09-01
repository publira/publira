-- Orphan image reclamation (cmd/batch purge-orphan-images).
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
-- Expected plans (empty table may still seq-scan; SET enable_seqscan = off
-- in the integration test to confirm the index is eligible):
--   ListReferencedObjectKeys
--     -> idx_<entity>_image_variants_object_key, once per variant table
--   DeleteUnreferencedCreatorImages / ...LabelImages / ...SeriesImages /
--   ...TenantImages
--     -> no index; one anti-join per run over a table that holds one row per
--        entity image

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
    OR EXISTS (SELECT 1 FROM creator_image_variants v WHERE v.object_key = c.object_key)
    OR EXISTS (SELECT 1 FROM episode_image_variants v WHERE v.object_key = c.object_key);

-- name: DeleteUnreferencedCreatorImages :execrows
-- An upload points its creator at the new icon and leaves the previous
-- creator_images row behind, referenced by nothing. created_at guards the
-- upload still in flight, whose row exists before the creator names it.
DELETE FROM creator_images ci
WHERE ci.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM creators c WHERE c.icon_image_id = ci.id);

-- name: DeleteUnreferencedLabelImages :execrows
DELETE FROM label_images li
WHERE li.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.eye_catch_image_id = li.id);

-- name: DeleteUnreferencedSeriesImages :execrows
DELETE FROM series_images si
WHERE si.created_at < @created_before
    AND NOT EXISTS (SELECT 1 FROM series s WHERE s.eye_catch_image_id = si.id);

-- name: DeleteUnreferencedTenantImages :execrows
-- A tenant image is reachable from either branding slot, and the theme holds
-- both, so one row can be the icon of one theme and nothing else anywhere.
DELETE FROM tenant_images ti
WHERE ti.created_at < @created_before
    AND NOT EXISTS (
        SELECT 1 FROM tenant_themes t
        WHERE t.icon_image_id = ti.id OR t.logo_image_id = ti.id
    );
