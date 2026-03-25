-- テーブルをリネーム
ALTER TABLE admin_audit_logs RENAME TO platform_audit_logs;

-- UUID FK カラムを追加（まず nullable として）
ALTER TABLE platform_audit_logs
    ADD COLUMN actor_platform_user_id UUID REFERENCES platform_users(id);

-- actor_user_public_id → actor_platform_user_id バックフィル
UPDATE platform_audit_logs p
    SET actor_platform_user_id = pu.id
    FROM platform_users pu
    WHERE pu.public_id = p.actor_user_public_id;

-- target_id を UUID 文字列にバックフィル
UPDATE platform_audit_logs p
    SET target_id = pu.id::text
    FROM platform_users pu
    WHERE p.target_type = 'operator' AND pu.public_id = p.target_id;

UPDATE platform_audit_logs p
    SET target_id = u.id::text
    FROM users u
    WHERE p.target_type = 'user' AND u.public_id = p.target_id;

UPDATE platform_audit_logs p
    SET target_id = t.id::text
    FROM tenants t
    WHERE p.target_type = 'tenant' AND t.public_id = p.target_id;

-- actor_platform_user_id に NOT NULL 制約を追加
ALTER TABLE platform_audit_logs
    ALTER COLUMN actor_platform_user_id SET NOT NULL;

-- 古い文字列カラムを削除
ALTER TABLE platform_audit_logs DROP COLUMN actor_user_public_id;
ALTER TABLE platform_audit_logs DROP COLUMN tenant_public_id;

-- インデックスを再作成
DROP INDEX IF EXISTS idx_admin_audit_logs_actor;
DROP INDEX IF EXISTS idx_admin_audit_logs_tenant;
DROP INDEX IF EXISTS idx_admin_audit_logs_created_at;
CREATE INDEX idx_platform_audit_logs_actor ON platform_audit_logs (actor_platform_user_id);
CREATE INDEX idx_platform_audit_logs_created_at ON platform_audit_logs (created_at DESC);
CREATE INDEX idx_platform_audit_logs_target ON platform_audit_logs (target_type, target_id);

-- テナントごとの監査ログテーブルを新規作成
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(id),
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64),
    target_id TEXT,
    outcome VARCHAR(16) NOT NULL,
    reason TEXT,
    client_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs (tenant_id);
CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs (actor_user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
