-- The tenant a variant belongs to, indexed the way its siblings
-- series_image_variants and creator_image_variants are: a tenant that is
-- deleted cascades through this column, and the policy on the table reads it on
-- every row it admits.
--
-- Alone in its file, and concurrent, because episode_image_variants already
-- carries every page of every episode and the upload path writes to it. A plain
-- CREATE INDEX would block those writes for the length of the build.
CREATE INDEX CONCURRENTLY idx_episode_image_variants_tenant_id ON episode_image_variants USING btree (tenant_id);
