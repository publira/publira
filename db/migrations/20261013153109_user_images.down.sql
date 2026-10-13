-- Dropping the column takes its foreign key and its CHECK constraint with it.
ALTER TABLE ONLY users
    DROP COLUMN icon_image_id;

DROP TABLE user_image_variants;

DROP TABLE user_images;
