-- name: ListTenantBrandMarks :many
-- Every mark the tenant holds an image for, with the account that accepted its
-- owner's terms, for the console. A mark whose image is gone shows nothing on
-- the storefront and is left out here too, so the console offers the upload
-- again. The account's columns are NULL once it is deleted.
SELECT bm.kind,
    bm.image_id,
    ti.updated_at AS image_updated_at,
    bm.terms_url,
    bm.terms_accepted_at,
    u.public_id AS terms_accepted_by_user_public_id,
    u.name AS terms_accepted_by_user_name
FROM tenant_brand_marks bm
JOIN tenant_images ti ON ti.tenant_id = bm.tenant_id
    AND ti.id = bm.image_id
LEFT JOIN users u ON u.tenant_id = bm.tenant_id
    AND u.id = bm.terms_accepted_by_user_id
WHERE bm.tenant_id = $1
ORDER BY bm.kind;

-- name: ListPublicTenantBrandMarks :many
-- What the storefront draws a mark from: its image, and when and under which
-- page its owner's terms were accepted. Who accepted them is the console's
-- alone, so this reads no account.
SELECT bm.kind,
    bm.image_id,
    ti.updated_at AS image_updated_at,
    bm.terms_url,
    bm.terms_accepted_at
FROM tenant_brand_marks bm
JOIN tenant_images ti ON ti.tenant_id = bm.tenant_id
    AND ti.id = bm.image_id
WHERE bm.tenant_id = $1
ORDER BY bm.kind;

-- name: GetTenantBrandMarkImageID :one
-- The image a kind holds now, which an upload replaces. The caller holds the
-- tenant's row lock, so no other write to the tenant's marks runs between this
-- read and its own.
SELECT image_id
FROM tenant_brand_marks
WHERE tenant_id = $1
    AND kind = $2;

-- name: UpsertTenantBrandMark :exec
-- Uploading a kind again replaces its image and its consent together: the
-- terms were accepted for the image being stored, at the time of the upload.
INSERT INTO tenant_brand_marks (
        tenant_id,
        kind,
        image_id,
        terms_url,
        terms_accepted_by_user_id,
        terms_accepted_at,
        updated_at
    )
VALUES (
        @tenant_id,
        @kind,
        @image_id,
        @terms_url,
        @terms_accepted_by_user_id,
        NOW(),
        NOW()
    ) ON CONFLICT (tenant_id, kind) DO
UPDATE
SET image_id = EXCLUDED.image_id,
    terms_url = EXCLUDED.terms_url,
    terms_accepted_by_user_id = EXCLUDED.terms_accepted_by_user_id,
    terms_accepted_at = EXCLUDED.terms_accepted_at,
    updated_at = NOW();

-- name: DeleteTenantBrandMark :one
-- Deletes the mark and its consent record, answering the image it held so the
-- caller can delete that too.
DELETE FROM tenant_brand_marks
WHERE tenant_id = $1
    AND kind = $2
RETURNING image_id;
