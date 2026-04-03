CREATE TABLE creator_images (
	id UUID PRIMARY KEY,
	tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_creator_images_tenant_id ON creator_images (tenant_id);
CREATE INDEX idx_creator_images_creator_id ON creator_images (creator_id);

ALTER TABLE creator_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_images_tenant_isolation ON creator_images
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE creator_image_variants (
	id UUID PRIMARY KEY,
	tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	creator_image_id UUID NOT NULL REFERENCES creator_images(id) ON DELETE CASCADE,
	label VARCHAR(32) NOT NULL,
	storage_provider VARCHAR(32) NOT NULL,
	object_key TEXT NOT NULL,
	content_type VARCHAR(255) NOT NULL,
	file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
	width INT NOT NULL CHECK (width > 0),
	height INT NOT NULL CHECK (height > 0),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_creator_image_variants_tenant_id ON creator_image_variants (tenant_id);
CREATE INDEX idx_creator_image_variants_creator_image_id ON creator_image_variants (creator_image_id);

ALTER TABLE creator_image_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_image_variants_tenant_isolation ON creator_image_variants
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE creators
ADD COLUMN icon_image_id UUID REFERENCES creator_images(id) ON DELETE SET NULL;
