CREATE TABLE episode_images (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    storage_provider VARCHAR(32) NOT NULL,
    object_key TEXT NOT NULL,
    image_url TEXT NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    display_order INT NOT NULL DEFAULT 0,
    width INT NOT NULL CHECK (width > 0),
    height INT NOT NULL CHECK (height > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_episode_images_episode_id ON episode_images (episode_id, display_order);
CREATE INDEX idx_episode_images_tenant_id ON episode_images (tenant_id);
