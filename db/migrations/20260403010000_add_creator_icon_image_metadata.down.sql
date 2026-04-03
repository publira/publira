ALTER TABLE creators
DROP COLUMN IF EXISTS icon_image_id;

DROP POLICY IF EXISTS creator_image_variants_tenant_isolation ON creator_image_variants;
ALTER TABLE creator_image_variants DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS creator_image_variants;

DROP POLICY IF EXISTS creator_images_tenant_isolation ON creator_images;
ALTER TABLE creator_images DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS creator_images;
