-- Create application DB users and roles.
-- This is intentionally seed (not migration) because role/user management is environment responsibility.
-- For production: run this seed as a superuser, then ALTER ROLE to set secure passwords.

-- Non-login bypass role for explicit grants in production environments.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_rls_bypass') THEN
        CREATE ROLE publira_rls_bypass NOLOGIN BYPASSRLS;
    ELSE
        ALTER ROLE publira_rls_bypass NOLOGIN BYPASSRLS;
    END IF;
END
$$;

-- Platform API user: BYPASSRLS to query across all tenants.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_platform') THEN
        CREATE ROLE publira_platform LOGIN PASSWORD 'platformpass' BYPASSRLS;
    ELSE
        ALTER ROLE publira_platform LOGIN BYPASSRLS;
    END IF;
END
$$;

-- Admin API user: subject to RLS (tenant-scoped).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_admin') THEN
        CREATE ROLE publira_admin LOGIN PASSWORD 'adminpass';
    ELSE
        ALTER ROLE publira_admin LOGIN;
    END IF;
END
$$;

-- Public API user: subject to RLS (tenant-scoped).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_public') THEN
        CREATE ROLE publira_public LOGIN PASSWORD 'publicpass';
    ELSE
        ALTER ROLE publira_public LOGIN;
    END IF;
END
$$;

-- Grant database access for all app users. `current_database()` keeps a
-- worktree profile's isolated `publira_<profile>` database self-contained.
DO $$
BEGIN
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO publira_platform, publira_admin, publira_public',
        current_database()
    );
END
$$;
GRANT USAGE ON SCHEMA public TO publira_platform, publira_admin, publira_public;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO publira_platform, publira_admin, publira_public;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO publira_platform, publira_admin, publira_public;

-- Ensure tables/sequences created by subsequent migrations automatically inherit app grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO publira_platform, publira_admin, publira_public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO publira_platform, publira_admin, publira_public;
