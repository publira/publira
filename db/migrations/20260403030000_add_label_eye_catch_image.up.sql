CREATE TABLE label_images (
	id UUID PRIMARY KEY,
	tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_label_images_tenant_id ON label_images (tenant_id);
CREATE INDEX idx_label_images_label_id ON label_images (label_id);

ALTER TABLE label_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY label_images_tenant_isolation ON label_images
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE label_image_variants (
	id UUID PRIMARY KEY,
	tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	label_image_id UUID NOT NULL REFERENCES label_images(id) ON DELETE CASCADE,
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

CREATE INDEX idx_label_image_variants_tenant_id ON label_image_variants (tenant_id);
CREATE INDEX idx_label_image_variants_label_image_id ON label_image_variants (label_image_id);
CREATE UNIQUE INDEX uq_label_image_variants_label_image_type_width
	ON label_image_variants (label_image_id, variant_type, width);

ALTER TABLE label_image_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY label_image_variants_tenant_isolation ON label_image_variants
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE labels
ADD COLUMN eye_catch_image_id UUID REFERENCES label_images(id) ON DELETE SET NULL;