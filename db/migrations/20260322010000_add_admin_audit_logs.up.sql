CREATE TABLE admin_audit_logs (
    id UUID PRIMARY KEY,
    actor_user_public_id VARCHAR(12) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    tenant_public_id VARCHAR(12),
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64),
    target_id VARCHAR(64),
    outcome VARCHAR(16) NOT NULL,
    reason TEXT,
    client_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_logs_actor ON admin_audit_logs (actor_user_public_id);
CREATE INDEX idx_admin_audit_logs_tenant ON admin_audit_logs (tenant_public_id);
CREATE INDEX idx_admin_audit_logs_created_at ON admin_audit_logs (created_at DESC);
