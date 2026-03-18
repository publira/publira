CREATE TABLE tenants (
    id UUID PRIMARY KEY,
    public_id VARCHAR(12) NOT NULL UNIQUE,
    domain VARCHAR(255) UNIQUE,
    subdomain VARCHAR(255) UNIQUE,
    name TEXT NOT NULL,
    default_reading_period_hours INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE users (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    public_id VARCHAR(12) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE tenant_themes (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    primary_color VARCHAR(32) NOT NULL,
    secondary_color VARCHAR(32) NOT NULL,
    accent_color VARCHAR(32) NOT NULL,
    logo_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE labels (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    public_id VARCHAR(12) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE series (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    label_id UUID REFERENCES labels(id),
    public_id VARCHAR(12) NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE series_listings (
    series_id UUID PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
    synopsis TEXT,
    reading_period_hours INT,
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE creators (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    public_id VARCHAR(12) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    profile_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE series_creators (
    series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (series_id, creator_id)
);
CREATE TABLE episodes (
    id UUID PRIMARY KEY,
    series_id UUID NOT NULL REFERENCES series(id),
    public_id VARCHAR(12) NOT NULL UNIQUE,
    title TEXT NOT NULL,
    order_index INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE episode_listings (
    episode_id UUID PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    price INT NOT NULL DEFAULT 0,
    reading_period_hours INT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published')),
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ
);
CREATE TABLE purchases (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    episode_id UUID NOT NULL REFERENCES episodes(id),
    price_at_purchase INT NOT NULL,
    expires_at TIMESTAMPTZ,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_series_tenant_id ON series (tenant_id);
CREATE INDEX idx_episodes_series_id ON episodes (series_id);
CREATE INDEX idx_episode_listings_status_scheduled ON episode_listings (status, scheduled_at);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
