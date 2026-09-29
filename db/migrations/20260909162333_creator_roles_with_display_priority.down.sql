-- The credits keep their rows here too. What they lose is the role, because
-- the column they are going back to holds a free string and nothing read it:
-- the admin API wrote "creator" into it, the seed "author", the test helper
-- "writer". Writing a role's name in its place would be inventing a value no
-- reader wants, so every credit goes back with the column empty.
ALTER TABLE series_creators
    ADD COLUMN role character varying(50) NOT NULL DEFAULT '';

ALTER TABLE series_creators
    ALTER COLUMN role DROP DEFAULT;

-- The narrow key holds one row per (series_id, creator_id), so a creator who
-- came to hold two roles on one series cannot be written back whole. The
-- leading role is the one that survives, and a credit that states no role
-- survives over one that does: it is the row that was here before the widening.
DELETE FROM series_creators
WHERE ctid IN (
        SELECT ranked.ctid
        FROM (
                SELECT sc.ctid,
                    ROW_NUMBER() OVER (
                        PARTITION BY sc.series_id,
                        sc.creator_id
                        ORDER BY cr.display_priority ASC NULLS FIRST,
                            sc.display_order ASC
                    ) AS position
                FROM series_creators sc
                    LEFT JOIN creator_roles cr ON cr.id = sc.role_id
            ) ranked
        WHERE ranked.position > 1
    );

ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_tenant_role_id_fkey;

DROP INDEX IF EXISTS idx_series_creators_tenant_role;

ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_series_id_creator_id_role_id_key;

ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_pkey PRIMARY KEY (series_id, creator_id);

ALTER TABLE series_creators
    DROP COLUMN role_id;

DROP TABLE IF EXISTS creator_roles;
