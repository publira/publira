-- Introduce tenant-scoped Row Level Security (RLS) policies.
-- Policies rely on app.current_tenant_id, which is set per request by the application.
-- Platform API bypass role provisioning (CREATE ROLE / GRANT) is handled outside migration.

-- Direct tenant_id tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_isolation ON users
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant_isolation ON sessions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY labels_tenant_isolation ON labels
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE series ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_tenant_isolation ON series
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
CREATE POLICY creators_tenant_isolation ON creators
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE episode_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_images_tenant_isolation ON episode_images
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_config_tenant_isolation ON tenant_config
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE tenant_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_themes_tenant_isolation ON tenant_themes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE tenant_smtp_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_smtp_config_tenant_isolation ON tenant_smtp_config
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE user_email_verification_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_email_verification_tokens_tenant_isolation ON user_email_verification_tokens
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE user_email_change_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_email_change_tokens_tenant_isolation ON user_email_change_tokens
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE user_password_reset_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_password_reset_tokens_tenant_isolation ON user_password_reset_tokens
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE tenant_admin_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_admin_invitations_tenant_isolation ON tenant_admin_invitations
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Add tenant_id to indirect tenant tables and simplify RLS policies
-- Direct tenant_id comparison is more efficient than multi-JOIN EXISTS checks

-- episodes: Add tenant_id column, backfill from series, then enable RLS
ALTER TABLE episodes ADD COLUMN tenant_id UUID;
UPDATE episodes SET tenant_id = s.tenant_id FROM series s WHERE s.id = episodes.series_id;
ALTER TABLE episodes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE episodes ADD CONSTRAINT fk_episodes_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_episodes_tenant_id ON episodes (tenant_id);

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY episodes_tenant_isolation ON episodes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- episode_listings: Add tenant_id column, backfill from episodes → series, then enable RLS
ALTER TABLE episode_listings ADD COLUMN tenant_id UUID;
UPDATE episode_listings SET tenant_id = e.tenant_id FROM episodes e WHERE e.id = episode_listings.episode_id;
ALTER TABLE episode_listings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE episode_listings ADD CONSTRAINT fk_episode_listings_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_episode_listings_tenant_id ON episode_listings (tenant_id);

ALTER TABLE episode_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_listings_tenant_isolation ON episode_listings
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- series_creators: Add tenant_id column, backfill from series, then enable RLS
ALTER TABLE series_creators ADD COLUMN tenant_id UUID;
UPDATE series_creators SET tenant_id = s.tenant_id FROM series s WHERE s.id = series_creators.series_id;
ALTER TABLE series_creators ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE series_creators ADD CONSTRAINT fk_series_creators_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_series_creators_tenant_id ON series_creators (tenant_id);

ALTER TABLE series_creators ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_creators_tenant_isolation ON series_creators
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- series_listings: Add tenant_id column, backfill from series, then enable RLS
ALTER TABLE series_listings ADD COLUMN tenant_id UUID;
UPDATE series_listings SET tenant_id = s.tenant_id FROM series s WHERE s.id = series_listings.series_id;
ALTER TABLE series_listings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE series_listings ADD CONSTRAINT fk_series_listings_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_series_listings_tenant_id ON series_listings (tenant_id);

ALTER TABLE series_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_listings_tenant_isolation ON series_listings
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- purchases: Add tenant_id column, backfill from episodes → series, then enable RLS
ALTER TABLE purchases ADD COLUMN tenant_id UUID;
UPDATE purchases SET tenant_id = e.tenant_id FROM episodes e WHERE e.id = purchases.episode_id;
ALTER TABLE purchases ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE purchases ADD CONSTRAINT fk_purchases_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_purchases_tenant_id ON purchases (tenant_id);

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchases_tenant_isolation ON purchases
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- tenant_user_roles: Add tenant_id column, backfill from users, then enable RLS
ALTER TABLE tenant_user_roles ADD COLUMN tenant_id UUID;
UPDATE tenant_user_roles SET tenant_id = u.tenant_id FROM users u WHERE u.id = tenant_user_roles.user_id;
ALTER TABLE tenant_user_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tenant_user_roles ADD CONSTRAINT fk_tenant_user_roles_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_tenant_user_roles_tenant_id ON tenant_user_roles (tenant_id);

ALTER TABLE tenant_user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_user_roles_tenant_isolation ON tenant_user_roles
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
