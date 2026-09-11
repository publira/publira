-- Create application DB users and roles.
-- This is intentionally seed (not migration) because role/user management is environment responsibility.
-- For production: run this seed as a superuser, then ALTER ROLE to set secure passwords.

-- Every DO block below states the whole attribute set on both branches. ALTER ROLE
-- changes only the attributes it names, so an ELSE branch listing just LOGIN and
-- BYPASSRLS would let a pre-existing role keep SUPERUSER, CREATEDB, CREATEROLE, or
-- REPLICATION.

-- Non-login bypass role for explicit grants in production environments.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_rls_bypass') THEN
        CREATE ROLE publira_rls_bypass NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    ELSE
        ALTER ROLE publira_rls_bypass NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    END IF;
END
$$;

-- Platform API user: BYPASSRLS to query across all tenants.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_platform') THEN
        CREATE ROLE publira_platform LOGIN PASSWORD 'platformpass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    ELSE
        ALTER ROLE publira_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    END IF;
END
$$;

-- Daily content stats worker: a separate BYPASSRLS login so the cron job
-- cannot accidentally run through a tenant-scoped API role.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_content_stats') THEN
        CREATE ROLE publira_content_stats LOGIN PASSWORD 'contentstatspass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    ELSE
        ALTER ROLE publira_content_stats LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    END IF;
END
$$;

-- Outbox worker: a BYPASSRLS login that claims pending outbox rows across
-- every tenant. It is separate from publira_content_stats because the worker
-- also owns River's schema, which the daily batches must not be able to alter.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_outbox') THEN
        CREATE ROLE publira_outbox LOGIN PASSWORD 'outboxpass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    ELSE
        ALTER ROLE publira_outbox LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    END IF;
END
$$;

-- Admin API user: subject to RLS (tenant-scoped).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_admin') THEN
        CREATE ROLE publira_admin LOGIN PASSWORD 'adminpass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    ELSE
        ALTER ROLE publira_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$$;

-- Public API user: subject to RLS (tenant-scoped).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_public') THEN
        CREATE ROLE publira_public LOGIN PASSWORD 'publicpass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    ELSE
        ALTER ROLE publira_public LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$$;

-- Grant database access for all app users. `current_database()` keeps a
-- worktree profile's isolated `publira_<profile>` database self-contained.
DO $$
BEGIN
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public',
        current_database()
    );
END
$$;
GRANT USAGE ON SCHEMA public TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;

-- Ensure tables/sequences created by subsequent migrations automatically inherit app grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;

-- episode_rating_counts and series_rating_counts are derived, not written: they
-- are the tallies of episode_ratings and only the triggers on that table may
-- move them. The grants above hand every table to every app role, so the API
-- roles have to give these back, or a storefront connection could set the
-- numbers its own tenant's readers see without a single rating behind them. The
-- triggers keep working because they are SECURITY DEFINER; nothing else may
-- write here.
--
-- This runs after the migrations, like the ALL TABLES grants above, so the
-- tables exist by the time the revoke names them.
--
-- The other derived tables — content_daily_stats, content_ranking_snapshots,
-- item_recommend_features — still carry the blanket grant. Taking it off them
-- is publira/publira#2010.
REVOKE INSERT, UPDATE, DELETE ON episode_rating_counts, series_rating_counts FROM publira_admin, publira_public;

-- River versions its own schema (river_job and the rest) and outbox-worker
-- applies it with rivermigrate at startup, so that role needs to create tables,
-- types, indexes, and functions in the schema. No other app role does.
GRANT CREATE ON SCHEMA public TO publira_outbox;
