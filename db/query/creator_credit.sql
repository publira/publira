-- The credits that name one creator, on series and on episodes alike, for the
-- console to show what keeps the creator from being deleted. Every series and
-- episode counts whatever its state, as GetCreatorDeletionBlocker counts them.
--
-- A credit is placed by (series_id, kind_rank, episode_order_index,
-- episode_id, role_key): a series in the order it was created, the credit on
-- the series itself before those on its episodes, the episodes in their
-- reading order, and a person holding two roles on one of them in role id
-- order. The series credit carries the nil uuid for episode_id, and role_key
-- is the role id with the nil uuid for a credit that states none, so every
-- key is non-null and the row comparison stays a plain one.
--
-- The keys span two tables and a join to episodes, so no index holds them.
-- idx_series_creators_tenant_creator and idx_episode_creators_tenant_creator
-- find the creator's credits, and only those are sorted: they are the credits
-- of one person, not a scan of the tenant's catalogue.
--
-- The titles are those of the tenant default locale, as every admin list
-- shows them. The joins to the translations are outer so that a credit is
-- listed even on a series or an episode that has none.
--
-- Forward uses the ascending query and backward the descending one, which the
-- handler puts back in ascending order. Cursor rules: proto/README.md.

-- name: ListCreatorCreditsAsc :many
WITH credits AS (
    SELECT sc.series_id,
        0::int4 AS kind_rank,
        0::int4 AS episode_order_index,
        '00000000-0000-0000-0000-000000000000'::uuid AS episode_id,
        COALESCE(
            sc.role_id,
            '00000000-0000-0000-0000-000000000000'::uuid
        )::uuid AS role_key,
        sc.role_id,
        ''::text AS episode_public_id,
        ''::text AS episode_title,
        ''::text AS source
    FROM series_creators sc
    WHERE sc.tenant_id = sqlc.arg('tenant_id')
        AND sc.creator_id = sqlc.arg('creator_id')
    UNION ALL
    SELECT e.series_id,
        1::int4,
        e.order_index,
        ec.episode_id,
        COALESCE(
            ec.role_id,
            '00000000-0000-0000-0000-000000000000'::uuid
        ),
        ec.role_id,
        e.public_id::text,
        COALESCE(et.title, '')::text,
        ec.source
    FROM episode_creators ec
        JOIN episodes e ON e.id = ec.episode_id
        LEFT JOIN LATERAL episode_translation_for(e.id, '') et ON true
    WHERE ec.tenant_id = sqlc.arg('tenant_id')
        AND ec.creator_id = sqlc.arg('creator_id')
)
SELECT c.series_id,
    s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    c.kind_rank,
    c.episode_order_index,
    c.episode_id,
    c.role_key,
    c.episode_public_id,
    c.episode_title,
    c.source,
    cr.id AS role_id,
    cr.public_id AS role_public_id,
    cr.name AS role_name
FROM credits c
    JOIN series s ON s.id = c.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, '') st ON true
    LEFT JOIN creator_roles cr ON cr.id = c.role_id
WHERE sqlc.narg('cursor_series_id')::uuid IS NULL
    OR (
        sqlc.arg('cursor_inclusive')::boolean
        AND (
            c.series_id,
            c.kind_rank,
            c.episode_order_index,
            c.episode_id,
            c.role_key
        ) >= (
            sqlc.narg('cursor_series_id')::uuid,
            sqlc.narg('cursor_kind_rank')::int4,
            sqlc.narg('cursor_episode_order_index')::int4,
            sqlc.narg('cursor_episode_id')::uuid,
            sqlc.narg('cursor_role_key')::uuid
        )
    )
    OR (
        NOT sqlc.arg('cursor_inclusive')::boolean
        AND (
            c.series_id,
            c.kind_rank,
            c.episode_order_index,
            c.episode_id,
            c.role_key
        ) > (
            sqlc.narg('cursor_series_id')::uuid,
            sqlc.narg('cursor_kind_rank')::int4,
            sqlc.narg('cursor_episode_order_index')::int4,
            sqlc.narg('cursor_episode_id')::uuid,
            sqlc.narg('cursor_role_key')::uuid
        )
    )
ORDER BY c.series_id ASC,
    c.kind_rank ASC,
    c.episode_order_index ASC,
    c.episode_id ASC,
    c.role_key ASC
LIMIT sqlc.arg('limit');

-- name: ListCreatorCreditsDesc :many
WITH credits AS (
    SELECT sc.series_id,
        0::int4 AS kind_rank,
        0::int4 AS episode_order_index,
        '00000000-0000-0000-0000-000000000000'::uuid AS episode_id,
        COALESCE(
            sc.role_id,
            '00000000-0000-0000-0000-000000000000'::uuid
        )::uuid AS role_key,
        sc.role_id,
        ''::text AS episode_public_id,
        ''::text AS episode_title,
        ''::text AS source
    FROM series_creators sc
    WHERE sc.tenant_id = sqlc.arg('tenant_id')
        AND sc.creator_id = sqlc.arg('creator_id')
    UNION ALL
    SELECT e.series_id,
        1::int4,
        e.order_index,
        ec.episode_id,
        COALESCE(
            ec.role_id,
            '00000000-0000-0000-0000-000000000000'::uuid
        ),
        ec.role_id,
        e.public_id::text,
        COALESCE(et.title, '')::text,
        ec.source
    FROM episode_creators ec
        JOIN episodes e ON e.id = ec.episode_id
        LEFT JOIN LATERAL episode_translation_for(e.id, '') et ON true
    WHERE ec.tenant_id = sqlc.arg('tenant_id')
        AND ec.creator_id = sqlc.arg('creator_id')
)
SELECT c.series_id,
    s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    c.kind_rank,
    c.episode_order_index,
    c.episode_id,
    c.role_key,
    c.episode_public_id,
    c.episode_title,
    c.source,
    cr.id AS role_id,
    cr.public_id AS role_public_id,
    cr.name AS role_name
FROM credits c
    JOIN series s ON s.id = c.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, '') st ON true
    LEFT JOIN creator_roles cr ON cr.id = c.role_id
WHERE sqlc.narg('cursor_series_id')::uuid IS NULL
    OR (
        sqlc.arg('cursor_inclusive')::boolean
        AND (
            c.series_id,
            c.kind_rank,
            c.episode_order_index,
            c.episode_id,
            c.role_key
        ) <= (
            sqlc.narg('cursor_series_id')::uuid,
            sqlc.narg('cursor_kind_rank')::int4,
            sqlc.narg('cursor_episode_order_index')::int4,
            sqlc.narg('cursor_episode_id')::uuid,
            sqlc.narg('cursor_role_key')::uuid
        )
    )
    OR (
        NOT sqlc.arg('cursor_inclusive')::boolean
        AND (
            c.series_id,
            c.kind_rank,
            c.episode_order_index,
            c.episode_id,
            c.role_key
        ) < (
            sqlc.narg('cursor_series_id')::uuid,
            sqlc.narg('cursor_kind_rank')::int4,
            sqlc.narg('cursor_episode_order_index')::int4,
            sqlc.narg('cursor_episode_id')::uuid,
            sqlc.narg('cursor_role_key')::uuid
        )
    )
ORDER BY c.series_id DESC,
    c.kind_rank DESC,
    c.episode_order_index DESC,
    c.episode_id DESC,
    c.role_key DESC
LIMIT sqlc.arg('limit');
