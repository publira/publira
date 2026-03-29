-- Add SMTP settings schema for platform default and tenant override

CREATE TABLE platform_smtp_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    host TEXT NOT NULL,
    port INT NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    encryption VARCHAR(16) NOT NULL CHECK (encryption IN ('tls', 'starttls', 'none')),
    from_address VARCHAR(255) NOT NULL,
    reply_to VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_smtp_config (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    smtp_override_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    host TEXT,
    port INT CHECK (port BETWEEN 1 AND 65535),
    username TEXT,
    password_encrypted TEXT,
    encryption VARCHAR(16) CHECK (encryption IN ('tls', 'starttls', 'none')),
    from_name TEXT,
    from_address VARCHAR(255),
    reply_to VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_smtp_config_required_when_enabled CHECK (
        NOT smtp_override_enabled
        OR (
            host IS NOT NULL
            AND port IS NOT NULL
            AND username IS NOT NULL
            AND password_encrypted IS NOT NULL
            AND encryption IS NOT NULL
            AND from_address IS NOT NULL
        )
    )
);
