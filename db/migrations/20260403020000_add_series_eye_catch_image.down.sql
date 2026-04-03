ALTER TABLE series
DROP COLUMN IF EXISTS eye_catch_image_id;

DROP POLICY IF EXISTS series_image_variants_tenant_isolation ON series_image_variants;
ALTER TABLE series_image_variants DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS series_image_variants;

DROP POLICY IF EXISTS series_images_tenant_isolation ON series_images;
ALTER TABLE series_images DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS series_images;
