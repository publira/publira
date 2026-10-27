-- The marks whose variant no longer fits go with their images, as the brand
-- marks migration's own down takes them all.
DELETE FROM tenant_brand_marks
WHERE length(kind) > 16;

DELETE FROM tenant_images
WHERE id IN (
        SELECT tenant_image_id
        FROM tenant_image_variants
        WHERE length(variant_type) > 16
    );

ALTER TABLE ONLY tenant_image_variants
    ALTER COLUMN variant_type TYPE character varying(16);
