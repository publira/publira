-- The marks' images go with the table: the restored check refuses their
-- variant rows, and the images hold nothing else.
DELETE FROM tenant_images
WHERE id IN (
        SELECT tenant_image_id
        FROM tenant_image_variants
        WHERE variant_type IN ('x_share', 'line_share', 'app_store_badge', 'google_play_badge', 'apple_sign_in', 'google_sign_in')
    );

ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_variant_type_check,
    ADD CONSTRAINT tenant_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['logo'::character varying, 'icon'::character varying, 'sign_in'::character varying])::text[])));

DROP TABLE tenant_brand_marks;
