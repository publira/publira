ALTER TABLE ONLY genres
    DROP CONSTRAINT genres_tenant_eye_catch_image_id_fkey;

ALTER TABLE ONLY genres
    DROP COLUMN eye_catch_image_id;

DROP TABLE genre_image_variants;

DROP TABLE genre_images;
