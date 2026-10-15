-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY users
    DROP CONSTRAINT users_one_icon_check,
    ADD CONSTRAINT users_one_icon_check CHECK (((icon_image_id IS NULL) OR (icon_preset_id IS NULL))) NOT VALID,
    DROP CONSTRAINT users_icon_preset_id_tenant_check,
    ADD CONSTRAINT users_icon_preset_id_tenant_check CHECK (((icon_preset_id IS NULL) OR (tenant_id IS NOT NULL))) NOT VALID,
    DROP CONSTRAINT users_tenant_icon_preset_id_fkey,
    ADD CONSTRAINT users_tenant_icon_preset_id_fkey FOREIGN KEY (tenant_id, icon_preset_id) REFERENCES reader_icon_presets(tenant_id, id) ON DELETE SET NULL (icon_preset_id) NOT VALID;
