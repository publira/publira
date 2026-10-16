-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_tenant_eye_catch_image_id_fkey,
    ADD CONSTRAINT episodes_tenant_eye_catch_image_id_fkey FOREIGN KEY (tenant_id, eye_catch_image_id) REFERENCES episode_eye_catch_images(tenant_id, id) ON DELETE SET NULL (eye_catch_image_id) NOT VALID;
