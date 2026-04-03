ALTER TABLE labels
DROP COLUMN IF EXISTS eye_catch_image_id;

DROP POLICY IF EXISTS label_image_variants_tenant_isolation ON label_image_variants;
ALTER TABLE label_image_variants DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS label_image_variants;

DROP POLICY IF EXISTS label_images_tenant_isolation ON label_images;
ALTER TABLE label_images DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS label_images;