CREATE TABLE series_images (
	id UUID PRIMARY KEY,
	tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_series_images_tenant_id ON series_images (tenant_id);
CREATE INDEX idx_series_images_series_id ON series_images (series_id);

ALTER TABLE series_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_images_tenant_isolation ON series_images
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE series_image_variants (
	id UUID PRIMARY KEY,
	tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	series_image_id UUID NOT NULL REFERENCES series_images(id) ON DELETE CASCADE,
	label VARCHAR(32) NOT NULL,
	variant_type VARCHAR(16) NOT NULL CHECK (variant_type IN ('portrait', 'square', 'landscape', 'og')),
	storage_provider VARCHAR(32) NOT NULL,
	object_key TEXT NOT NULL,
	content_type VARCHAR(255) NOT NULL,
	file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
	width INT NOT NULL CHECK (width > 0),
	height INT NOT NULL CHECK (height > 0),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_series_image_variants_tenant_id ON series_image_variants (tenant_id);
CREATE INDEX idx_series_image_variants_series_image_id ON series_image_variants (series_image_id);
CREATE UNIQUE INDEX uq_series_image_variants_series_image_type_width
	ON series_image_variants (series_image_id, variant_type, width);

ALTER TABLE series_image_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_image_variants_tenant_isolation ON series_image_variants
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE series
ADD COLUMN eye_catch_image_id UUID REFERENCES series_images(id) ON DELETE SET NULL;
