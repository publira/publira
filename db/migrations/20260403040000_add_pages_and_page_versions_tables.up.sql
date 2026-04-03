-- ============================================================
-- Issue #297: テナント向け個別ページとバージョン管理の追加
-- ============================================================

CREATE TABLE pages (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(255) NOT NULL,
    title TEXT NOT NULL,
    published_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE page_versions (
    id UUID PRIMARY KEY,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    version_number INT NOT NULL CHECK (version_number > 0),
    content_markdown TEXT NOT NULL DEFAULT '',
    author_user_id UUID REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    publish_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    UNIQUE (page_id, version_number),
    CHECK (
        (status = 'draft' AND published_at IS NULL)
        OR (status = 'published' AND published_at IS NOT NULL)
    )
);

ALTER TABLE pages
    ADD CONSTRAINT pages_published_version_id_fkey
    FOREIGN KEY (published_version_id) REFERENCES page_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_pages_tenant_id ON pages (tenant_id);
CREATE INDEX idx_pages_published_version_id ON pages (published_version_id);
CREATE INDEX idx_page_versions_page_id_created_at ON page_versions (page_id, created_at DESC);
CREATE INDEX idx_page_versions_status_publish_at ON page_versions (status, publish_at);