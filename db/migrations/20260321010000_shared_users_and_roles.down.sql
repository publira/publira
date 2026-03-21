DROP INDEX IF EXISTS idx_sessions_current_tenant_id_token_hash;

ALTER TABLE users ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'tenant_admin';

ALTER TABLE sessions ALTER COLUMN current_tenant_id SET NOT NULL;
ALTER TABLE sessions RENAME COLUMN current_tenant_id TO tenant_id;

DROP TABLE IF EXISTS platform_user_roles;
DROP TABLE IF EXISTS tenant_member_roles;
DROP TABLE IF EXISTS tenant_memberships;
