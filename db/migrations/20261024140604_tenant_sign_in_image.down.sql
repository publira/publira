-- The sign-in images go with the slot: the restored check refuses their
-- variant rows, and the images hold nothing else.
DELETE FROM tenant_images
WHERE id IN (
        SELECT tenant_image_id
        FROM tenant_image_variants
        WHERE variant_type = 'sign_in'
    );

ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_variant_type_check;

ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['logo'::character varying, 'icon'::character varying])::text[])));

ALTER TABLE ONLY tenant_themes
    DROP CONSTRAINT tenant_themes_tenant_sign_in_image_id_fkey;

ALTER TABLE ONLY tenant_themes
    DROP COLUMN sign_in_image_id;
