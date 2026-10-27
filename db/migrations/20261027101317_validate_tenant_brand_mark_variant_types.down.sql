-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_variant_type_check,
    ADD CONSTRAINT tenant_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['logo'::character varying, 'icon'::character varying, 'sign_in'::character varying, 'x_share'::character varying, 'line_share'::character varying, 'app_store_badge'::character varying, 'google_play_badge'::character varying, 'apple_sign_in'::character varying, 'google_sign_in'::character varying])::text[]))) NOT VALID;
