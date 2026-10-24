-- COLUMN: tenant_themes sign_in_image_id
-- The image beside the storefront's sign-in and sign-up forms, a third
-- branding slot next to the icon and the logo. NULL is a tenant that has not
-- uploaded one.
ALTER TABLE ONLY tenant_themes
    ADD COLUMN sign_in_image_id uuid;

-- FK CONSTRAINT: tenant_themes tenant_themes_tenant_sign_in_image_id_fkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_tenant_sign_in_image_id_fkey FOREIGN KEY (tenant_id, sign_in_image_id) REFERENCES tenant_images(tenant_id, id) ON DELETE SET NULL (sign_in_image_id);

-- CONSTRAINT: tenant_image_variants tenant_image_variants_variant_type_check
ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_variant_type_check;

ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['logo'::character varying, 'icon'::character varying, 'sign_in'::character varying])::text[])));
