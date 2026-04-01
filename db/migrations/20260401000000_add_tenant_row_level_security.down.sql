DROP POLICY IF EXISTS tenant_user_roles_tenant_isolation ON tenant_user_roles;
ALTER TABLE tenant_user_roles DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_tenant_user_roles_tenant_id;
ALTER TABLE tenant_user_roles DROP CONSTRAINT IF EXISTS fk_tenant_user_roles_tenant_id;
ALTER TABLE tenant_user_roles DROP COLUMN IF EXISTS tenant_id;

DROP POLICY IF EXISTS purchases_tenant_isolation ON purchases;
ALTER TABLE purchases DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_purchases_tenant_id;
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS fk_purchases_tenant_id;
ALTER TABLE purchases DROP COLUMN IF EXISTS tenant_id;

DROP POLICY IF EXISTS series_listings_tenant_isolation ON series_listings;
ALTER TABLE series_listings DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_series_listings_tenant_id;
ALTER TABLE series_listings DROP CONSTRAINT IF EXISTS fk_series_listings_tenant_id;
ALTER TABLE series_listings DROP COLUMN IF EXISTS tenant_id;

DROP POLICY IF EXISTS series_creators_tenant_isolation ON series_creators;
ALTER TABLE series_creators DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_series_creators_tenant_id;
ALTER TABLE series_creators DROP CONSTRAINT IF EXISTS fk_series_creators_tenant_id;
ALTER TABLE series_creators DROP COLUMN IF EXISTS tenant_id;

DROP POLICY IF EXISTS episode_listings_tenant_isolation ON episode_listings;
ALTER TABLE episode_listings DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_episode_listings_tenant_id;
ALTER TABLE episode_listings DROP CONSTRAINT IF EXISTS fk_episode_listings_tenant_id;
ALTER TABLE episode_listings DROP COLUMN IF EXISTS tenant_id;

DROP POLICY IF EXISTS episodes_tenant_isolation ON episodes;
ALTER TABLE episodes DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_episodes_tenant_id;
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS fk_episodes_tenant_id;
ALTER TABLE episodes DROP COLUMN IF EXISTS tenant_id;

DROP POLICY IF EXISTS tenant_admin_invitations_tenant_isolation ON tenant_admin_invitations;
ALTER TABLE tenant_admin_invitations DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_password_reset_tokens_tenant_isolation ON user_password_reset_tokens;
ALTER TABLE user_password_reset_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_email_change_tokens_tenant_isolation ON user_email_change_tokens;
ALTER TABLE user_email_change_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_email_verification_tokens_tenant_isolation ON user_email_verification_tokens;
ALTER TABLE user_email_verification_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_smtp_config_tenant_isolation ON tenant_smtp_config;
ALTER TABLE tenant_smtp_config DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_themes_tenant_isolation ON tenant_themes;
ALTER TABLE tenant_themes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_config_tenant_isolation ON tenant_config;
ALTER TABLE tenant_config DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS episode_images_tenant_isolation ON episode_images;
ALTER TABLE episode_images DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creators_tenant_isolation ON creators;
ALTER TABLE creators DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS series_tenant_isolation ON series;
ALTER TABLE series DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS labels_tenant_isolation ON labels;
ALTER TABLE labels DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_tenant_isolation ON sessions;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
