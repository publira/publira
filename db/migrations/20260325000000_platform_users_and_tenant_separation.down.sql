-- ============================================================
-- Issue #210 ロールバック: platform_users分離の取り消し
-- ============================================================

-- 1. 削除したテーブルを復元
CREATE TABLE tenant_memberships (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tenant_id)
);

CREATE TABLE tenant_member_roles (
    id UUID PRIMARY KEY,
    membership_id UUID NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (membership_id, role)
);

-- 2. sessions の tenant_id を current_tenant_id に戻す
DROP INDEX IF EXISTS idx_sessions_tenant_id_token_hash;
ALTER TABLE sessions RENAME COLUMN tenant_id TO current_tenant_id;
ALTER TABLE sessions ALTER COLUMN current_tenant_id DROP NOT NULL;
CREATE INDEX idx_sessions_current_tenant_id_token_hash ON sessions (current_tenant_id, token_hash);

-- 3. platform_users を users に戻す
INSERT INTO users (id, public_id, email, password_hash, name, status, created_at)
SELECT id, public_id, email, password_hash, name, status, created_at
FROM platform_users;

-- 4. platform_sessions を sessions に戻す
INSERT INTO sessions (id, current_tenant_id, user_id, token_hash, expires_at, revoked_at, created_at)
SELECT id, NULL, platform_user_id, token_hash, expires_at, revoked_at, created_at
FROM platform_sessions;

-- 5. tenant_user_roles から tenant_memberships + tenant_member_roles を best-effort 復元
INSERT INTO tenant_memberships (id, user_id, tenant_id, status, created_at)
SELECT
    gen_random_uuid(),
    u.id,
    u.tenant_id,
    'active',
    u.created_at
FROM users u
WHERE u.tenant_id IS NOT NULL
  AND u.id NOT IN (SELECT id FROM platform_users);

INSERT INTO tenant_member_roles (id, membership_id, role, created_at)
SELECT
    tur.id,
    tm.id,
    tur.role,
    tur.created_at
FROM tenant_user_roles tur
JOIN users u ON u.id = tur.user_id
JOIN tenant_memberships tm ON tm.user_id = u.id AND tm.tenant_id = u.tenant_id;

-- 6. platform_user_roles の FK を users に戻す
ALTER TABLE platform_user_roles ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE platform_user_roles SET user_id = platform_user_id;
ALTER TABLE platform_user_roles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE platform_user_roles DROP CONSTRAINT platform_user_roles_platform_user_id_fkey;
ALTER TABLE platform_user_roles DROP COLUMN platform_user_id;
ALTER TABLE platform_user_roles ADD CONSTRAINT platform_user_roles_user_id_role_key UNIQUE (user_id, role);

-- 7. users から tenant_id を削除
DROP INDEX IF EXISTS idx_users_tenant_id_email;
ALTER TABLE users DROP COLUMN tenant_id;
-- グローバル email UNIQUE 制約を復元
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

-- 8. 新設テーブルを削除
DROP TABLE IF EXISTS tenant_user_roles;
DROP TABLE IF EXISTS platform_sessions;
DROP TABLE platform_users;
