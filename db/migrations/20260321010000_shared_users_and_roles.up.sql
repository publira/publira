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

CREATE TABLE platform_user_roles (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, role)
);

ALTER TABLE sessions RENAME COLUMN tenant_id TO current_tenant_id;
ALTER TABLE sessions ALTER COLUMN current_tenant_id DROP NOT NULL;

ALTER TABLE users DROP COLUMN tenant_id;
ALTER TABLE users DROP COLUMN role;

CREATE INDEX idx_sessions_current_tenant_id_token_hash ON sessions (current_tenant_id, token_hash);
