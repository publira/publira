-- Create application DB users and roles.
-- This is intentionally seed (not migration) because role/user management is environment responsibility.
-- psql applies this directory through prod.sql and `publiractl db roles` applies it directly, so no file
-- here may use a psql meta-command. Roles are created without a password: `publiractl db roles` sets
-- them, and dev/000_role_passwords.sql sets the development ones.

-- Nothing here needs a superuser: the connection has to own the database and
-- the schema and have CREATEROLE, which is what a managed PostgreSQL such as
-- Cloud SQL gives its customer. No role here carries BYPASSRLS, which only a
-- role holding it may give: the roles that work across tenants are members of
-- publira_rls_bypass, and this file puts a policy letting that role's members
-- through on every table under row-level security.

-- publira_ensure_role leaves a role with exactly the attributes given and the
-- rest denied. ALTER ROLE changes only the attributes it names, so a role that
-- already exists is compared attribute by attribute: one that kept SUPERUSER,
-- CREATEDB, CREATEROLE, REPLICATION, or BYPASSRLS from an earlier definition
-- loses it. Only the attributes that differ are named, because PostgreSQL
-- refuses NOSUPERUSER, NOREPLICATION, and NOBYPASSRLS from a role that lacks
-- the attribute itself, even when nothing would change.
CREATE FUNCTION pg_temp.publira_ensure_role(role_name name, can_login boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    existing pg_roles;
    changes text[] := ARRAY[]::text[];
BEGIN
    SELECT * INTO existing FROM pg_roles WHERE rolname = role_name;
    IF NOT FOUND THEN
        EXECUTE format(
            'CREATE ROLE %I %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT',
            role_name,
            CASE WHEN can_login THEN 'LOGIN' ELSE 'NOLOGIN' END
        );
        RETURN;
    END IF;
    IF existing.rolcanlogin <> can_login THEN
        changes := changes || CASE WHEN can_login THEN 'LOGIN' ELSE 'NOLOGIN' END;
    END IF;
    IF existing.rolsuper THEN
        changes := changes || 'NOSUPERUSER'::text;
    END IF;
    IF existing.rolcreatedb THEN
        changes := changes || 'NOCREATEDB'::text;
    END IF;
    IF existing.rolcreaterole THEN
        changes := changes || 'NOCREATEROLE'::text;
    END IF;
    IF existing.rolreplication THEN
        changes := changes || 'NOREPLICATION'::text;
    END IF;
    IF existing.rolbypassrls THEN
        changes := changes || 'NOBYPASSRLS'::text;
    END IF;
    IF NOT existing.rolinherit THEN
        changes := changes || 'INHERIT'::text;
    END IF;
    IF cardinality(changes) > 0 THEN
        EXECUTE format('ALTER ROLE %I %s', role_name, array_to_string(changes, ' '));
    END IF;
END
$$;

DO $$
BEGIN
    -- The roles that work across tenants are its members. It cannot log in,
    -- and the policies further down name it rather than each member, so a
    -- role is given or denied every tenant's rows by its membership alone.
    PERFORM pg_temp.publira_ensure_role('publira_rls_bypass', false);

    -- Platform API user: works across tenants.
    PERFORM pg_temp.publira_ensure_role('publira_platform', true);

    -- Maintenance jobs (the worker's and publiractl's): a separate login that
    -- works across tenants, so they cannot accidentally run through a
    -- tenant-scoped API role.
    PERFORM pg_temp.publira_ensure_role('publira_content_stats', true);

    -- Outbox worker: a login that claims pending outbox rows across every
    -- tenant. It is separate from publira_content_stats because the worker
    -- also owns River's schema, which the daily batches must not be able to
    -- alter.
    PERFORM pg_temp.publira_ensure_role('publira_outbox', true);

    -- Ticker jobs: the login for the three jobs that act the moment a stored
    -- instant passes — publishing due episodes, applying free window
    -- boundaries, and rolling each tenant's calendar day. Each one spans every
    -- tenant, and none of them creates anything: the grants below name the
    -- tables they read and write rather than handing over the schema the way
    -- the blanket grants do.
    PERFORM pg_temp.publira_ensure_role('publira_ticker', true);

    -- Admin API user: subject to RLS (tenant-scoped).
    PERFORM pg_temp.publira_ensure_role('publira_admin', true);

    -- Public API user: subject to RLS (tenant-scoped).
    PERFORM pg_temp.publira_ensure_role('publira_public', true);
END
$$;

DROP FUNCTION pg_temp.publira_ensure_role(name, boolean);

-- Membership is what reaches every tenant, so the two tenant-scoped roles are
-- taken out of publira_rls_bypass if anything ever put them in. The four that
-- work across tenants are made members that inherit it: a policy applies to
-- the roles whose privileges include its role's, which a membership without
-- INHERIT is not. A GRANT that leaves INHERIT out takes it from the member's
-- own attribute, so it is named.
DO $$
DECLARE
    role_name name;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['publira_platform', 'publira_content_stats', 'publira_outbox', 'publira_ticker'] LOOP
        IF NOT pg_has_role(role_name, 'publira_rls_bypass', 'USAGE') THEN
            EXECUTE format('GRANT publira_rls_bypass TO %I WITH INHERIT TRUE', role_name);
        END IF;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['publira_admin', 'publira_public'] LOOP
        IF pg_has_role(role_name, 'publira_rls_bypass', 'MEMBER') THEN
            EXECUTE format('REVOKE publira_rls_bypass FROM %I', role_name);
        END IF;
    END LOOP;
END
$$;

-- publira_outbox owns River's tables once the worker has started, and the
-- blanket grants below and 010_river_object_owner.sql both act on them: the
-- grants as their owner, the transfer by handing them to it. A superuser may
-- do both outright. Any other connection needs the privileges of
-- publira_outbox for the first and the right to SET ROLE to it for the second,
-- and a membership gives it both when it names both: a login created NOINHERIT
-- would otherwise get one it cannot act as the owner through. The role that created publira_outbox may
-- grant that, and nothing else changes for it: it already owns everything
-- else in the schema.
DO $$
BEGIN
    IF NOT pg_has_role('publira_outbox', 'USAGE') THEN
        EXECUTE format('GRANT publira_outbox TO %I WITH INHERIT TRUE, SET TRUE', current_user);
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

-- A table a later migration creates reaches no app role until this directory
-- runs again, which every upgrade does right after `db migrate`, and the grants
-- above and the corrections below then reach it together. Earlier releases
-- handed it to every role on creation, through default privileges and an event
-- trigger, so both are taken away here.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE USAGE, SELECT ON SEQUENCES FROM publira_platform, publira_content_stats, publira_outbox, publira_admin, publira_public;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'publira_take_back_default_grants') THEN
        DROP EVENT TRIGGER publira_take_back_default_grants;
    END IF;
    IF to_regprocedure('public.publira_take_back_default_grants_on_create()') IS NOT NULL THEN
        DROP FUNCTION public.publira_take_back_default_grants_on_create();
    END IF;
END
$$;

-- The grants above hand every table to every app role, and two families of
-- table have to give them back. publira_take_back_default_grants decides both
-- for one relation.
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
-- spans tenants, publira_platform reaches every tenant, and a tenant isolation
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

-- publira_rls_bypass's members reach every tenant's rows through a policy of
-- that name on every table under row-level security. Permissive policies are
-- combined with OR, so for those members a table's tenant isolation policy
-- becomes `... OR true`, which the planner folds away; a role outside it is
-- not one the policy applies to, so its own queries are planned as before.
-- The grants still decide what each member may do to a table: this policy only
-- decides which rows, as BYPASSRLS would.
--
-- Like the grants, this reaches a table a later migration creates when this
-- directory runs again. Until then, the members see none of its rows. A policy
-- of that name that says anything else, such as one widened to PUBLIC, is
-- replaced; one that already says this is left alone, since replacing it would
-- lock the table against the processes serving from it.
--
-- It runs before the grants that name a table, which are the statements that
-- fail on a database a rollback took behind them.
DO $$
DECLARE
    relation regclass;
BEGIN
    FOR relation IN
        SELECT c.oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
            AND c.relrowsecurity
            AND NOT EXISTS (
                SELECT 1
                FROM pg_policy p
                WHERE p.polrelid = c.oid
                    AND p.polname = 'publira_rls_bypass'
                    AND p.polpermissive
                    AND p.polcmd = '*'
                    AND p.polroles = ARRAY['publira_rls_bypass'::regrole::oid]
                    AND pg_get_expr(p.polqual, p.polrelid) = 'true'
                    AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
            )
    LOOP
        IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = relation AND polname = 'publira_rls_bypass') THEN
            EXECUTE format('DROP POLICY publira_rls_bypass ON %s', relation);
        END IF;
        EXECUTE format(
            'CREATE POLICY publira_rls_bypass ON %s AS PERMISSIVE FOR ALL TO publira_rls_bypass USING (true) WITH CHECK (true)',
            relation
        );
    END LOOP;
END
$$;

-- The storefront and the tenant console charge their rate limits, and decide
-- whether a tenant admin owes a second factor, from the platform policy. It
-- holds no secret, so both roles read it; neither may write it.
GRANT SELECT ON platform_policy_config TO publira_public, publira_admin;

-- The storefront publishes the VAPID public key browsers subscribe with, and
-- only once a subject is saved. The grant names the columns that answer that,
-- so the sealed private key in the same row stays out of this role's reach.
GRANT SELECT (singleton, vapid_public_key, subject) ON platform_webpush_config TO publira_public;

-- A tenant that has saved no payment settings sells in the platform's default
-- currency, which the storefront prices its catalog in, the tenant console
-- shows prices in, and a royalty statement is closed in. The grant names that
-- column alone, so the rest of the platform settings stay out of these roles'
-- reach.
GRANT SELECT (singleton, default_currency) ON platform_config TO publira_public, publira_admin, publira_content_stats;

-- The tenant console names the address a tenant's mail is sent from, which is
-- the platform relay's for a tenant that overrides nothing, so a sender a mail
-- provider requires to be registered can be registered. The grant names that
-- column alone: the relay's host, account, and sealed password stay out of
-- this role's reach.
GRANT SELECT (singleton, from_address) ON platform_smtp_config TO publira_admin;

-- The storefront resolves each tenant's stricter community limits alongside
-- the platform policy. RLS confines the tenant-console role to its own row.
REVOKE INSERT, UPDATE, DELETE ON tenant_community_limit_overrides FROM publira_public;
REVOKE DELETE ON tenant_community_limit_overrides FROM publira_admin;
GRANT SELECT ON tenant_community_limit_overrides TO publira_public;
GRANT SELECT, INSERT, UPDATE ON tenant_community_limit_overrides TO publira_admin;

-- What a tenant refuses at reader sign-up is the tenant console's to set. The
-- storefront reads it on every sign-up and email change and must not be able
-- to switch it off or empty the list: RLS confines it to its own tenant, which
-- is exactly the tenant whose rule it would be lifting.
REVOKE INSERT, UPDATE, DELETE ON tenant_email_rejection_settings, tenant_email_rejection_entries FROM publira_public;
REVOKE DELETE ON tenant_email_rejection_settings FROM publira_admin;
GRANT SELECT ON tenant_email_rejection_settings, tenant_email_rejection_entries TO publira_public;
GRANT SELECT, INSERT, UPDATE ON tenant_email_rejection_settings TO publira_admin;
GRANT SELECT, INSERT, DELETE ON tenant_email_rejection_entries TO publira_admin;

-- The tenant console tells staff when a withdrawn comment is deleted, and the
-- purge batches delete by the same period, so both resolve a tenant's retention
-- from the platform defaults. They hold no secret, and neither role may write
-- them.
GRANT SELECT ON platform_retention_config TO publira_admin, publira_content_stats;

-- The object store is resolved from the platform's settings by publira server
-- as the login of the surface that reads from it — the storefront's images as
-- publira_public, the tenant console's images and uploads as publira_admin —
-- and by the orphan image sweep on the maintenance pool. The secret access key
-- is stored encrypted under keys the database never holds, and none of these
-- roles may write the row.
GRANT SELECT ON platform_storage_config TO publira_public, publira_admin, publira_content_stats;

-- The spent MFA challenge purge runs on the maintenance pool and drains the
-- platform console's spent challenges along with the tenant consoles'. A row
-- names only a token identifier, an operator's internal id, and two times, so
-- it is the one operator table that role may reach. The FOR UPDATE SKIP LOCKED
-- that keeps two runs off each other's rows needs UPDATE on at least one
-- column, so the grant names one and no more.
GRANT SELECT, DELETE, UPDATE (used_at) ON platform_user_mfa_used_challenges TO publira_content_stats;

-- The catalog search engine is read by the worker, which writes every
-- catalog_index_sync event into the index the search answers from and into the
-- one being built, by the maintenance role, which builds that index and then
-- moves the search onto it, and by publira server as the storefront's login,
-- which the public API's search is answered as. The password is stored
-- encrypted under keys the database never holds. Only the build may move the
-- serving configuration or record a failure, and no role here may write what an
-- operator saved.
GRANT SELECT ON platform_search_config TO publira_public, publira_outbox, publira_content_stats;
GRANT UPDATE (
    serving_revision,
    serving_engine,
    serving_url,
    serving_index_alias,
    serving_username,
    serving_password_encrypted,
    serving_analysis,
    serving_since,
    build_failed_revision,
    build_error,
    build_failed_at
) ON platform_search_config TO publira_content_stats;

-- tenant_fcm_config holds a sealed service account key. The tenant console
-- writes it under RLS and the worker reads it to send mobile push; no reader's
-- request and no maintenance job has any use for it.
REVOKE ALL ON tenant_fcm_config FROM publira_platform, publira_content_stats, publira_public;
REVOKE INSERT, UPDATE, DELETE ON tenant_fcm_config FROM publira_outbox;

-- daily_rebuild_progress records how far the worker's daily rebuilds have got,
-- and only the maintenance role that runs them reads or moves it. A request
-- that moved it would make the worker skip a day or rebuild one again.
REVOKE ALL ON daily_rebuild_progress FROM publira_platform, publira_admin, publira_public, publira_outbox;

-- content_event_purges records how far the content event purge has reached, and
-- only the maintenance role reads or moves it: the purge writes it, and the
-- statistics rebuild reads it to leave alone a day whose events are gone.
REVOKE ALL ON content_event_purges FROM publira_platform, publira_admin, publira_public, publira_outbox;

-- The worker composes the platform console's own mail — a password reset, an
-- email change confirmation, the notice that follows one — and every mail it
-- sends goes through the platform relay unless the tenant overrides it. It also
-- signs every Web Push delivery with the platform's VAPID key pair. So the
-- tables those paths read are granted back one by one, the way the ticker
-- role's are, and a platform_ table added later reaches this role only when
-- someone puts it in this list.
GRANT SELECT ON
    platform_config,
    platform_smtp_config,
    platform_webpush_config,
    platform_users,
    platform_user_email_change_tokens,
    platform_user_password_reset_tokens
TO publira_outbox;

-- The platform console's password reset form records the request and answers,
-- so the worker is what finds the operator and issues the link: it replaces the
-- operator's unfinished reset tokens with the one its mail carries.
GRANT INSERT, DELETE ON platform_user_password_reset_tokens TO publira_outbox;

-- River versions its own schema (river_job and the rest) and the worker
-- applies it with rivermigrate at startup, so that role needs to create tables,
-- types, indexes, and functions in the schema. No other app role does.
GRANT CREATE ON SCHEMA public TO publira_outbox;

-- publira_ticker is deliberately absent from every grant above. The blanket
-- ALL TABLES grants hand a role whatever the schema holds each time this
-- directory runs, which after an upgrade includes what a migration added, and
-- the ticker jobs read and write a known, small set of tables. So they are
-- named one by one here: a table added to the schema reaches this role only
-- when someone puts it in this list, and a job that starts reading a table it
-- was never granted fails in its integration test rather than in production.
--
-- Reads: the due listings, series, windows and pinned banners, the catalog
-- rows the log lines name, the recipients each notification fans out to, and
-- the views that decide whether a published episode is announced at all. A
-- security_invoker view reads its tables with this role's own rights, so the
-- views it is built on are granted alongside it.
GRANT SELECT ON
    episode_listings,
    announcements,
    episodes,
    series,
    series_surfaces,
    episode_surfaces,
    published_episode_surfaces,
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

-- Writes: the listing a publish promotes, a series publication dates, or the
-- fan-out records an announcement on, the window boundary a drop answers for,
-- and the rows the fan-out files. SELECT rides along on the last three
-- because each insert is an ON CONFLICT DO NOTHING with a RETURNING clause.
GRANT UPDATE ON episode_listings, episode_free_windows TO publira_ticker;
-- The pinned flag is the one column expire-pinned-announcements writes, and an
-- announcement carries the tenant's own words, so the grant names the column
-- rather than the table. This role reaches every tenant, so a table-wide UPDATE here
-- would let a ticker job rewrite any announcement of any tenant.
GRANT UPDATE (pinned) ON announcements TO publira_ticker;
-- The same holds for a series: apply-series-publications records the drop it
-- owed for a series whose publication instant has passed, and writes nothing
-- else of a row that carries the tenant's own catalog.
GRANT UPDATE (publication_revalidated_at) ON series TO publira_ticker;
GRANT SELECT, INSERT ON notifications, platform_notifications, outbox_events TO publira_ticker;
