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

-- Maintenance jobs (the worker's and publiractl's): a separate BYPASSRLS login so
-- they cannot accidentally run through a tenant-scoped API role.
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

-- Ticker jobs: a BYPASSRLS login for the three jobs that act the moment a
-- stored instant passes — publishing due episodes, applying free window
-- boundaries, and rolling each tenant's calendar day. Each one spans every
-- tenant, so it has to bypass RLS, and none of them creates anything: the
-- grants below name the tables they read and write rather than handing over
-- the schema the way the blanket grants do.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'publira_ticker') THEN
        CREATE ROLE publira_ticker LOGIN PASSWORD 'tickerpass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    ELSE
        ALTER ROLE publira_ticker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
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
        'GRANT CONNECT ON DATABASE %I TO publira_platform, publira_content_stats, publira_outbox, publira_ticker, publira_admin, publira_public',
        current_database()
    );
END
$$;
GRANT USAGE ON SCHEMA public TO publira_platform, publira_content_stats, publira_outbox, publira_ticker, publira_admin, publira_public;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;

-- Ensure tables/sequences created by subsequent migrations automatically inherit app grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;

-- The grants above hand every table to every app role, and two families of
-- table have to give them back. publira_take_back_default_grants decides both
-- for one relation, so the seed and the event trigger below apply one rule.
--
-- The derived tables are read by the API roles but never written by them, or a
-- storefront connection could set the numbers its own tenant's readers see:
-- their policies are tenant isolation, which does not stop that. The rating
-- tallies are moved only by the SECURITY DEFINER triggers on episode_ratings;
-- the daily stats, the tenant rating totals, the ranking snapshots, and the
-- recommendation features are rebuilt by the maintenance batches as
-- publira_content_stats, which keeps its grant.
--
-- The platform console's tables carry no policy, and correctly so: the console
-- spans tenants, publira_platform holds BYPASSRLS, and a tenant isolation
-- policy would have nothing to isolate on. The blanket grants are therefore the
-- only thing standing in front of the operators' password hashes and the
-- platform SMTP credentials, so the tenant-scoped and worker roles give the
-- whole platform_ prefix back. The prefix, rather than a list of today's
-- tables, is what keeps the next platform_ table covered the day it lands.
CREATE OR REPLACE FUNCTION public.publira_take_back_default_grants(relation regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    relation_name name;
BEGIN
    SELECT c.relname
    INTO relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = relation
        AND n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f');

    IF relation_name LIKE 'platform\_%' THEN
        EXECUTE format(
            'REVOKE ALL ON %s FROM publira_public, publira_admin, publira_content_stats, publira_outbox',
            relation
        );
    ELSIF relation_name IN (
        'episode_rating_counts',
        'series_rating_counts',
        'content_daily_stats',
        'tenant_rating_totals',
        'content_ranking_snapshots',
        'item_recommend_features',
        'user_recommend_features'
    ) THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %s FROM publira_admin, publira_public', relation);
    END IF;
END
$$;
REVOKE ALL ON FUNCTION public.publira_take_back_default_grants(regclass) FROM PUBLIC;

DO $$
BEGIN
    PERFORM public.publira_take_back_default_grants(c.oid)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f');
END
$$;

-- A migration applied after this seed creates its tables under the ALTER
-- DEFAULT PRIVILEGES above, so the rule is applied again as each relation is
-- created rather than only when the seed last ran. It fires on River's DDL at
-- worker startup as well, where it finds nothing to revoke; an error here would
-- abort that DDL, which is why the function only ever revokes.
CREATE OR REPLACE FUNCTION public.publira_take_back_default_grants_on_create()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    created oid;
BEGIN
    FOR created IN
        SELECT objid
        FROM pg_event_trigger_ddl_commands()
        WHERE classid = 'pg_class'::regclass
            AND object_type IN ('table', 'view', 'materialized view', 'foreign table')
    LOOP
        PERFORM public.publira_take_back_default_grants(created);
    END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.publira_take_back_default_grants_on_create() FROM PUBLIC;

DROP EVENT TRIGGER IF EXISTS publira_take_back_default_grants;
CREATE EVENT TRIGGER publira_take_back_default_grants
ON ddl_command_end
WHEN TAG IN (
    'CREATE TABLE',
    'CREATE TABLE AS',
    'SELECT INTO',
    'CREATE VIEW',
    'CREATE MATERIALIZED VIEW',
    'CREATE FOREIGN TABLE'
)
EXECUTE FUNCTION public.publira_take_back_default_grants_on_create();

-- The storefront and the tenant console charge their rate limits, and decide
-- whether a tenant admin owes a second factor, from the platform policy. It
-- holds no secret, so both roles read it; neither may write it.
GRANT SELECT ON platform_policy_config TO publira_public, publira_admin;

-- The storefront publishes the VAPID public key browsers subscribe with, and
-- only once a subject is saved. The grant names the columns that answer that,
-- so the sealed private key in the same row stays out of this role's reach.
GRANT SELECT (singleton, vapid_public_key, subject) ON platform_webpush_config TO publira_public;

-- The storefront resolves each tenant's stricter community limits alongside
-- the platform policy. RLS confines the tenant-console role to its own row.
REVOKE INSERT, UPDATE, DELETE ON tenant_community_limit_overrides FROM publira_public;
REVOKE DELETE ON tenant_community_limit_overrides FROM publira_admin;
GRANT SELECT ON tenant_community_limit_overrides TO publira_public;
GRANT SELECT, INSERT, UPDATE ON tenant_community_limit_overrides TO publira_admin;

-- The tenant console tells staff when a withdrawn comment is deleted, and the
-- purge batches delete by the same period, so both resolve a tenant's retention
-- from the platform defaults. They hold no secret, and neither role may write
-- them.
GRANT SELECT ON platform_retention_config TO publira_admin, publira_content_stats;

-- The image server and the orphan image sweep resolve the object store they
-- read and reclaim from the platform's settings, on the tenant console's pool
-- and the maintenance pool. The secret access key is stored encrypted under
-- keys the database never holds, and neither role may write the row.
GRANT SELECT ON platform_storage_config TO publira_admin, publira_content_stats;

-- tenant_fcm_config holds a sealed service account key. The tenant console
-- writes it under RLS and the worker reads it to send mobile push; no reader's
-- request and no maintenance job has any use for it.
REVOKE ALL ON tenant_fcm_config FROM publira_platform, publira_content_stats, publira_public;
REVOKE INSERT, UPDATE, DELETE ON tenant_fcm_config FROM publira_outbox;

-- daily_rebuild_progress records how far the worker's daily rebuilds have got,
-- and only the maintenance role that runs them reads or moves it. A request
-- that moved it would make the worker skip a day or rebuild one again.
REVOKE ALL ON daily_rebuild_progress FROM publira_platform, publira_admin, publira_public, publira_outbox;

-- The worker composes the platform console's own mail — a password reset, an
-- email change confirmation, the notice that follows one — and every mail it
-- sends goes through the platform relay unless the tenant overrides it. It also
-- signs every Web Push delivery with the platform's VAPID key pair. So the
-- tables those paths read are granted back one by one, the way the ticker
-- role's are: reads only, and a platform_ table added later reaches this role
-- only when someone puts it in this list.
GRANT SELECT ON
    platform_config,
    platform_smtp_config,
    platform_webpush_config,
    platform_users,
    platform_user_email_change_tokens,
    platform_user_password_reset_tokens
TO publira_outbox;

-- River versions its own schema (river_job and the rest) and the worker
-- applies it with rivermigrate at startup, so that role needs to create tables,
-- types, indexes, and functions in the schema. No other app role does.
GRANT CREATE ON SCHEMA public TO publira_outbox;

-- publira_ticker is deliberately absent from every grant above. The blanket
-- ALL TABLES grants and the ALTER DEFAULT PRIVILEGES that follows them hand a
-- role whatever the schema holds now and whatever a later migration adds, and
-- the three ticker jobs read and write a known, small set of tables. So they
-- are named one by one here: a table added to the schema reaches this role only
-- when someone puts it in this list, and a job that starts reading a table it
-- was never granted fails in its integration test rather than in production.
--
-- Reads: the due listings, windows and pinned banners, the catalog rows the log
-- lines name, and the recipients each notification fans out to.
GRANT SELECT ON
    episode_listings,
    announcements,
    episodes,
    series,
    tenants,
    platform_config,
    episode_free_windows,
    episode_follows,
    series_follows,
    creator_follows,
    episode_creators,
    tenant_user_roles,
    platform_users,
    platform_user_roles
TO publira_ticker;

-- Writes: the listing a publish promotes, the window boundary a drop answers
-- for, and the rows the fan-out files. SELECT rides along on the last three
-- because each insert is an ON CONFLICT DO NOTHING with a RETURNING clause.
GRANT UPDATE ON episode_listings, episode_free_windows TO publira_ticker;
-- The pinned flag is the one column expire-pinned-announcements writes, and an
-- announcement carries the tenant's own words, so the grant names the column
-- rather than the table. This role bypasses RLS, so a table-wide UPDATE here
-- would let a ticker job rewrite any announcement of any tenant.
GRANT UPDATE (pinned) ON announcements TO publira_ticker;
GRANT SELECT, INSERT ON notifications, platform_notifications, outbox_events TO publira_ticker;
