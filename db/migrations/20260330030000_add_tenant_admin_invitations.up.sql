CREATE TABLE tenant_admin_invitations (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

CREATE UNIQUE INDEX idx_tenant_admin_invitations_tenant_token_hash
    ON tenant_admin_invitations (tenant_id, token_hash);

CREATE INDEX idx_tenant_admin_invitations_tenant_created_at
    ON tenant_admin_invitations (tenant_id, created_at DESC);