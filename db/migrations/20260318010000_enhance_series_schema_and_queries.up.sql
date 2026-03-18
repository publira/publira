ALTER TABLE series
    ADD COLUMN synopsis TEXT,
    ADD COLUMN reading_period_hours INT,
    ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN published_at TIMESTAMPTZ,
    ADD COLUMN created_by UUID REFERENCES users(id),
    ADD COLUMN updated_by UUID REFERENCES users(id),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE series s
SET synopsis = sl.synopsis,
    reading_period_hours = sl.reading_period_hours,
    is_published = COALESCE(sl.is_published, false),
    published_at = CASE
        WHEN COALESCE(sl.is_published, false) THEN sl.published_at
        ELSE NULL
    END,
    updated_at = NOW()
FROM series_listings sl
WHERE sl.series_id = s.id;

CREATE INDEX idx_series_tenant_public_id ON series (tenant_id, public_id);
CREATE INDEX idx_series_tenant_created_at ON series (tenant_id, created_at DESC);
CREATE INDEX idx_series_tenant_published_at ON series (tenant_id, is_published, published_at DESC);
