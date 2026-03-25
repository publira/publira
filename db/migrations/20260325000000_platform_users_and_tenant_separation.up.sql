-- ============================================================
-- Issue #210: platform_users導入とテナントユーザー境界の明確化
-- プラットフォーム責務とテナント責務を物理分離する
-- ============================================================

-- 1. platform_users テーブルを新設（プラットフォーム管理者専用）
CREATE TABLE platform_users (
    id UUID PRIMARY KEY,
    public_id VARCHAR(12) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 既存 users の中でプラットフォームロールを持つユーザーを platform_users へコピー
INSERT INTO platform_users (id, public_id, email, password_hash, name, status, created_at)
SELECT u.id, u.public_id, u.email, u.password_hash, u.name, u.status, u.created_at
FROM users u
WHERE EXISTS (
    SELECT 1 FROM platform_user_roles pur WHERE pur.user_id = u.id
);

-- 3. platform_user_roles の外部キーを platform_users に切り替える
ALTER TABLE platform_user_roles ADD COLUMN platform_user_id UUID REFERENCES platform_users(id) ON DELETE CASCADE;
UPDATE platform_user_roles SET platform_user_id = user_id;
ALTER TABLE platform_user_roles ALTER COLUMN platform_user_id SET NOT NULL;
ALTER TABLE platform_user_roles DROP CONSTRAINT platform_user_roles_user_id_fkey;
ALTER TABLE platform_user_roles DROP COLUMN user_id;
ALTER TABLE platform_user_roles DROP CONSTRAINT IF EXISTS platform_user_roles_user_id_role_key;
ALTER TABLE platform_user_roles ADD CONSTRAINT platform_user_roles_platform_user_id_role_key UNIQUE (platform_user_id, role);

-- 4. platform_sessions テーブルを新設（プラットフォーム専用セッション）
CREATE TABLE platform_sessions (
    id UUID PRIMARY KEY,
    platform_user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_platform_sessions_platform_user_id ON platform_sessions (platform_user_id);

-- 5. 既存 sessions のうち current_tenant_id IS NULL のもの（プラットフォームセッション）を移行
INSERT INTO platform_sessions (id, platform_user_id, token_hash, expires_at, revoked_at, created_at)
SELECT s.id, s.user_id, s.token_hash, s.expires_at, s.revoked_at, s.created_at
FROM sessions s
WHERE s.current_tenant_id IS NULL;

-- 6. users に tenant_id を再追加（初期は NULL 許容、データ移行後に使用制限）
ALTER TABLE users ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- 7. tenant_memberships からテナント所属を users.tenant_id へコピー
UPDATE users u
SET tenant_id = tm.tenant_id
FROM tenant_memberships tm
WHERE tm.user_id = u.id;

-- 8. tenant_user_roles テーブルを新設（tenant_memberships + tenant_member_roles を置換）
CREATE TABLE tenant_user_roles (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, role)
);

-- 9. 既存のテナントロールを tenant_user_roles へコピー
INSERT INTO tenant_user_roles (id, user_id, role, created_at)
SELECT tmr.id, tm.user_id, tmr.role, tmr.created_at
FROM tenant_member_roles tmr
JOIN tenant_memberships tm ON tm.id = tmr.membership_id;

-- 10. プラットフォームユーザーのセッションを sessions から削除（platform_sessions に移行済み）
DELETE FROM sessions WHERE user_id IN (SELECT id FROM platform_users);
-- プラットフォームユーザーを users から削除（platform_users に移行済み）
DELETE FROM users WHERE id IN (SELECT id FROM platform_users);

-- 11. sessions を テナント専用に変換
-- current_tenant_id IS NULL のレコードはすでに platform_sessions へ移行済みなので削除
DELETE FROM sessions WHERE current_tenant_id IS NULL;
-- インデックスを再構築
DROP INDEX IF EXISTS idx_sessions_tenant_token_hash;
DROP INDEX IF EXISTS idx_sessions_current_tenant_id_token_hash;
-- カラムをリネーム、NOT NULL 制約を追加
ALTER TABLE sessions RENAME COLUMN current_tenant_id TO tenant_id;
ALTER TABLE sessions ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_sessions_tenant_id_token_hash ON sessions (tenant_id, token_hash);

-- 12. users.email のグローバル UNIQUE 制約を削除し、テナントスコープ UNIQUE を追加
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX idx_users_tenant_id_email ON users (tenant_id, email) WHERE tenant_id IS NOT NULL;

-- 13. 不要になったテーブルを削除
DROP TABLE tenant_member_roles;
DROP TABLE tenant_memberships;
