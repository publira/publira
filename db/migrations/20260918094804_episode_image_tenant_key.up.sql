-- The (tenant_id, id) key that the composite foreign key from
-- episode_image_variants names. PostgreSQL accepts a reference only against a
-- unique constraint on exactly those columns, and this table's primary key is
-- id alone.
--
-- Alone in its file, and concurrent, because episode_images holds one row per
-- page of every episode and the upload path writes to it. A plain CREATE INDEX
-- would block those writes for the length of the build. The migration that
-- finishes the sweep promotes this index to the constraint the reference wants.
CREATE UNIQUE INDEX CONCURRENTLY episode_images_tenant_id_id_key ON episode_images USING btree (tenant_id, id);
