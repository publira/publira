-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY users
    DROP CONSTRAINT users_icon_image_id_tenant_check,
    ADD CONSTRAINT users_icon_image_id_tenant_check CHECK (((icon_image_id IS NULL) OR (tenant_id IS NOT NULL))) NOT VALID,
    DROP CONSTRAINT users_tenant_icon_image_id_fkey,
    ADD CONSTRAINT users_tenant_icon_image_id_fkey FOREIGN KEY (tenant_id, icon_image_id) REFERENCES user_images(tenant_id, id) ON DELETE SET NULL (icon_image_id) NOT VALID;
