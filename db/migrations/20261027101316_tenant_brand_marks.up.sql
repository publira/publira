-- TABLE: tenant_brand_marks
-- A third-party mark the tenant uploaded to show on its storefront — a share
-- button's, a store badge, a sign-in button's — one per kind, with the terms of
-- the mark's owner it was uploaded under: which page the console showed, who
-- accepted it, and when. The storefront shows when and under which page a mark
-- was accepted, so the consent is a column of the mark rather than a row of the
-- audit log. Uploading a kind again replaces the image and the consent
-- together.
--
-- locale is left NULL until a mark can be uploaded once per language.
--
-- The primary key leads with tenant_id, so it also serves the two foreign keys
-- below when an image or an account is deleted: a tenant holds six rows at
-- most.
CREATE TABLE tenant_brand_marks (
    tenant_id uuid NOT NULL,
    kind text NOT NULL,
    image_id uuid,
    terms_url text NOT NULL,
    terms_accepted_by_user_id uuid,
    terms_accepted_at timestamp with time zone NOT NULL,
    locale text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_brand_marks_kind_check CHECK ((kind = ANY (ARRAY['x_share'::text, 'line_share'::text, 'app_store_badge'::text, 'google_play_badge'::text, 'apple_sign_in'::text, 'google_sign_in'::text])))
);

-- CONSTRAINT: tenant_brand_marks tenant_brand_marks_pkey
ALTER TABLE ONLY tenant_brand_marks
    ADD CONSTRAINT tenant_brand_marks_pkey PRIMARY KEY (tenant_id, kind);

-- FK CONSTRAINT: tenant_brand_marks tenant_brand_marks_tenant_id_fkey
ALTER TABLE ONLY tenant_brand_marks
    ADD CONSTRAINT tenant_brand_marks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_brand_marks tenant_brand_marks_tenant_image_id_fkey
ALTER TABLE ONLY tenant_brand_marks
    ADD CONSTRAINT tenant_brand_marks_tenant_image_id_fkey FOREIGN KEY (tenant_id, image_id) REFERENCES tenant_images(tenant_id, id) ON DELETE SET NULL (image_id);

-- FK CONSTRAINT: tenant_brand_marks tenant_brand_marks_tenant_terms_accepted_by_user_id_fkey
ALTER TABLE ONLY tenant_brand_marks
    ADD CONSTRAINT tenant_brand_marks_tenant_terms_accepted_by_user_id_fkey FOREIGN KEY (tenant_id, terms_accepted_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (terms_accepted_by_user_id);

-- ROW SECURITY: tenant_brand_marks
ALTER TABLE tenant_brand_marks ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_brand_marks tenant_brand_marks_tenant_isolation
CREATE POLICY tenant_brand_marks_tenant_isolation ON tenant_brand_marks USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: tenant_image_shown_by_brand_mark
-- Whether a brand mark shows the tenant image, for the policy below.
--
-- SECURITY DEFINER so the policy holds for a role that has no grant on
-- tenant_brand_marks yet: between this migration and the `db roles` run that
-- grants the table, a delete from tenant_images would otherwise fail on the
-- policy instead of being decided by it. It reads nothing but the one row its
-- arguments name, and search_path is fixed so the body cannot be pointed at
-- another schema's table.
CREATE FUNCTION tenant_image_shown_by_brand_mark(image_tenant_id uuid, tenant_image_id uuid) RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM tenant_brand_marks bm
        WHERE bm.tenant_id = image_tenant_id
            AND bm.image_id = tenant_image_id
    );
$$;

-- POLICY: tenant_images tenant_images_keep_brand_mark_images
-- A tenant image a brand mark shows is never deleted from under it. The
-- previous release's orphan image sweep knows only the theme's slots, and it
-- would take a mark's image for unreferenced; a restrictive policy leaves the
-- row out of that delete without failing it. The console deletes a mark's row
-- before its image, and a tenant's deletion reaches the image through foreign
-- keys, which row-level security does not apply to.
CREATE POLICY tenant_images_keep_brand_mark_images ON tenant_images AS RESTRICTIVE FOR DELETE USING ((NOT tenant_image_shown_by_brand_mark(tenant_id, id)));

-- CONSTRAINT: tenant_image_variants tenant_image_variants_variant_type_check
-- A mark's image is a tenant image whose variant names the mark's kind. Added
-- NOT VALID and validated by the next migration, so the scan of the existing
-- rows runs without the exclusive lock this one holds.
ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_variant_type_check,
    ADD CONSTRAINT tenant_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['logo'::character varying, 'icon'::character varying, 'sign_in'::character varying, 'x_share'::character varying, 'line_share'::character varying, 'app_store_badge'::character varying, 'google_play_badge'::character varying, 'apple_sign_in'::character varying, 'google_sign_in'::character varying])::text[]))) NOT VALID;
