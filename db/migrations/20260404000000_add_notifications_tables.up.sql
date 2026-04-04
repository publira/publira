CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(64) NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_reads (
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
);

-- 一覧取得（ユーザー別）
CREATE INDEX idx_notifications_tenant_target_created_at
ON notifications (tenant_id, target_user_id, created_at DESC);

-- 時系列取得（テナント全体）
CREATE INDEX idx_notifications_tenant_created_at
ON notifications (tenant_id, created_at DESC);

-- 未読判定/既読結合
CREATE INDEX idx_notification_reads_user_notification
ON notification_reads (user_id, notification_id);