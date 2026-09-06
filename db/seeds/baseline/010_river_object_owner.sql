-- Hand River's own objects to publira_outbox.
--
-- outbox-worker applies River's schema with rivermigrate at startup, so on a
-- database it has always connected to as publira_outbox that role already owns
-- river_job and the rest, and this file finds nothing to do.
--
-- A database whose River schema was created by another role — every stack that
-- ran the worker on the superuser connection before it had a role of its own —
-- keeps that owner, because connecting as a different role does not move
-- ownership. Such a stack drains normally and passes rivermigrate, which issues
-- no DDL while no version is pending, and then fails on the first River release
-- that alters an existing object: `ALTER TABLE river_job ADD COLUMN ...` as a
-- non-owner is `must be owner of table river_job`, which is a crash loop at
-- startup rather than a degraded worker.
--
-- Run as a superuser, like the rest of this directory. Object ownership is
-- environment responsibility, which is why this is a seed and not a migration.
DO $$
DECLARE
    statement text;
BEGIN
    FOR statement IN
        SELECT format('ALTER TABLE public.%I OWNER TO publira_outbox', c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname LIKE 'river\_%'
          AND c.relowner <> 'publira_outbox'::regrole
        UNION ALL
        -- ALTER TABLE carries a table's indexes and owned sequences with it, but
        -- not a sequence River created on its own, so both are named here.
        SELECT format('ALTER SEQUENCE public.%I OWNER TO publira_outbox', c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'S'
          AND c.relname LIKE 'river\_%'
          AND c.relowner <> 'publira_outbox'::regrole
        UNION ALL
        -- Enums and domains only: a table's row type and an enum's array type
        -- follow their parent, and ALTER TYPE refuses them.
        SELECT format('ALTER TYPE public.%I OWNER TO publira_outbox', t.typname)
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('e', 'd')
          AND t.typname LIKE 'river\_%'
          AND t.typowner <> 'publira_outbox'::regrole
        UNION ALL
        SELECT format('ALTER FUNCTION %s OWNER TO publira_outbox', p.oid::regprocedure)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname LIKE 'river\_%'
          AND p.proowner <> 'publira_outbox'::regrole
    LOOP
        EXECUTE statement;
    END LOOP;
END
$$;
