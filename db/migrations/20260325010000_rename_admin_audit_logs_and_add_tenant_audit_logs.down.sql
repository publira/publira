-- audit_logs テーブルを削除
DROP TABLE IF EXISTS audit_logs;

-- platform_audit_logs のインデックスを削除
DROP INDEX IF EXISTS idx_platform_audit_logs_actor;
DROP INDEX IF EXISTS idx_platform_audit_logs_created_at;
DROP INDEX IF EXISTS idx_platform_audit_logs_target;

-- 古い文字列カラムを再追加
ALTER TABLE platform_audit_logs
    ADD COLUMN actor_user_public_id VARCHAR(12),
    ADD COLUMN tenant_public_id VARCHAR(12);

-- UUID → public_id へのバックフィル
UPDATE platform_audit_logs p
    SET actor_user_public_id = pu.public_id
    FROM platform_users pu
    WHERE pu.id = p.actor_platform_user_id;

-- target_id を public_id に戻す
UPDATE platform_audit_logs p
    SET target_id = pu.public_id
    FROM platform_users pu
    WHERE p.target_type = 'operator' AND pu.id::text = p.target_id;

UPDATE platform_audit_logs p
    SET target_id = u.public_id
    FROM users u
    WHERE p.target_type = 'user' AND u.id::text = p.target_id;

UPDATE platform_audit_logs p
    SET target_id = t.public_id
    FROM tenants t
    WHERE p.target_type = 'tenant' AND t.id::text = p.target_id;

-- NOT NULL 制約をセット
ALTER TABLE platform_audit_logs
    ALTER COLUMN actor_user_public_id SET NOT NULL;

-- FK と UUID カラムを削除
ALTER TABLE platform_audit_logs
    DROP COLUMN actor_platform_user_id;

-- テーブルを元の名前に戻す
ALTER TABLE platform_audit_logs RENAME TO admin_audit_logs;

-- 元のインデックスを再作成
CREATE INDEX idx_admin_audit_logs_actor ON admin_audit_logs (actor_user_public_id);
CREATE INDEX idx_admin_audit_logs_tenant ON admin_audit_logs (tenant_public_id);
CREATE INDEX idx_admin_audit_logs_created_at ON admin_audit_logs (created_at DESC);
