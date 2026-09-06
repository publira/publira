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
    -- Every object River's own migrations create, through river v0.47.0.
    -- Ownership is granted by name, so a name River does not create is a name
    -- this repository owns, and handing it to publira_outbox would give the
    -- worker authority over a table of ours. Matching a prefix instead would do
    -- exactly that, silently, the day someone adds `river_reports`.
    --
    -- The list only has to cover what an earlier role could have created:
    -- anything a later River release adds is created by publira_outbox itself
    -- and never becomes a candidate. river_client and river_client_queue are
    -- here because River 005 creates them and 007 drops them again, so a
    -- database that stopped in between still holds them.
    known_tables text[] := ARRAY[
        'river_client', 'river_client_queue', 'river_job', 'river_leader',
        'river_migration', 'river_notification', 'river_queue'
    ];
    known_sequences text[] := ARRAY['river_job_id_seq', 'river_notification_id_seq'];
    known_types text[] := ARRAY['river_job_state'];
    known_functions text[] := ARRAY['river_job_notify', 'river_job_state_in_bitmask'];
    unknown text;
    statement text;
BEGIN
    -- Indexes and triggers are not listed: both follow the table ALTER TABLE
    -- moves, so they are neither transferred nor judged on their own.
    SELECT string_agg(name, ', ' ORDER BY name)
    INTO unknown
    FROM (
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname LIKE 'river\_%'
          AND c.relowner <> 'publira_outbox'::regrole
          AND ((c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (known_tables)))
            OR (c.relkind = 'S' AND NOT (c.relname = ANY (known_sequences))))
        UNION ALL
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('e', 'd')
          AND t.typname LIKE 'river\_%'
          AND t.typowner <> 'publira_outbox'::regrole
          AND NOT (t.typname = ANY (known_types))
        UNION ALL
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname LIKE 'river\_%'
          AND p.proowner <> 'publira_outbox'::regrole
          AND NOT (p.proname = ANY (known_functions))
    ) AS candidates;

    IF unknown IS NOT NULL THEN
        RAISE EXCEPTION 'public objects named like River''s but not created by it: %', unknown
            USING HINT = 'Add them above when a newer River release creates them; otherwise rename them, because this file would hand them to publira_outbox.';
    END IF;

    FOR statement IN
        SELECT format('ALTER TABLE public.%I OWNER TO publira_outbox', c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname = ANY (known_tables)
          AND c.relowner <> 'publira_outbox'::regrole
        UNION ALL
        -- ALTER TABLE carries a table's indexes and owned sequences with it, but
        -- not a sequence River created on its own, so both are named here.
        SELECT format('ALTER SEQUENCE public.%I OWNER TO publira_outbox', c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'S'
          AND c.relname = ANY (known_sequences)
          AND c.relowner <> 'publira_outbox'::regrole
        UNION ALL
        SELECT format('ALTER TYPE public.%I OWNER TO publira_outbox', t.typname)
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = ANY (known_types)
          AND t.typowner <> 'publira_outbox'::regrole
        UNION ALL
        SELECT format('ALTER FUNCTION %s OWNER TO publira_outbox', p.oid::regprocedure)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY (known_functions)
          AND p.proowner <> 'publira_outbox'::regrole
    LOOP
        EXECUTE statement;
    END LOOP;
END
$$;
