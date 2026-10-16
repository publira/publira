ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_tenant_eye_catch_image_id_fkey;

ALTER TABLE ONLY episodes
    DROP COLUMN eye_catch_image_id;

DROP TABLE episode_eye_catch_image_variants;

DROP TABLE episode_eye_catch_images;
