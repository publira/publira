-- 公開著者一覧の cursor ページネーションは 2 段構え。
--
-- 1 段目が ListPublishedAuthorIDsByName* で、公開中シリーズを 1 本以上持つ
-- creator の id だけを決める。並び替えキーは (name, id)。id は UUIDv7 なので
-- 同名でも一意に決まる。
--
-- 名前順は web-host が localeCompare(..., "ja") で並べていたが、ICU の ja
-- collation は環境ごとにロケールが揃っていないと cursor の比較結果が変わり、
-- btree のキーセット走査が破綻する。そのため DB の既定 collation で name を
-- 比較する。ja-x-icu を後から足すなら、その collation でインデックスを張り
-- 直し、cursor の比較も同じ collation に揃える。
--
-- EXISTS の公開判定は ListActiveSeriesIDsByPublishedAtDesc と同じ述語。
-- ここがずれるとシリーズ一覧と著者ページで見える作品が食い違う。
-- ORDER BY を向きごとに固定した別クエリに分けてあるのは、CASE で分岐させる
-- と idx_creators_tenant_name を索引順に読めなくなるため。前ページ方向は
-- 降順のクエリを呼んで呼び出し側で並べ直す。
--
-- 2 段目が ListPublishedAuthorsByIDs で、決まった id の表示内容と公開
-- シリーズ数だけを組み立てる。
-- name: ListPublishedAuthorIDsByNameAsc :many
SELECT c.id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) >= (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) > (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.name ASC,
    c.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPublishedAuthorIDsByNameDesc :many
SELECT c.id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) <= (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) < (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.name DESC,
    c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPublishedAuthorsByIDs :many
-- 並び順は付けない。1 段目が決めた id の順に呼び出し側が並べ直す。
SELECT c.id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM creators c
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM creator_image_variants
        WHERE creator_image_id = ci.id
        ORDER BY width DESC
        LIMIT 1
    ) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = ANY(sqlc.arg('ids')::uuid []);

-- name: GetPublishedAuthorByPublicID :one
-- 公開中シリーズを 1 本以上持つ creator だけを返す。不在と同じく呼び出し側
-- で not_found にするので、非公開の著者の存在は漏れない。
SELECT c.id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM creators c
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM creator_image_variants
        WHERE creator_image_id = ci.id
        ORDER BY width DESC
        LIMIT 1
    ) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.public_id = sqlc.arg('public_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
LIMIT 1;

-- name: ListCreatorsByPublicIDsForTenant :many
SELECT id,
    tenant_id,
    public_id,
    name,
    profile_text,
    created_at
FROM creators
WHERE tenant_id = $1
    AND public_id = ANY(sqlc.arg('public_ids')::varchar[]);

-- Admin ListCreators は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListCreatorsByTenantDesc :many
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY c.created_at DESC, c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListCreatorsByTenantAsc :many
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY c.created_at ASC, c.id ASC
LIMIT sqlc.arg('limit');

-- name: CreateCreator :one
INSERT INTO creators (
        id,
        tenant_id,
        public_id,
        name,
        profile_text,
        icon_image_id
    )
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateCreatorImage :one
INSERT INTO creator_images (
        id,
        tenant_id,
        creator_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateCreatorImageVariant :one
INSERT INTO creator_image_variants (
        id,
        tenant_id,
        creator_image_id,
        label,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetCreatorByPublicIDForTenant :one
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = $1
    AND c.public_id = $2
LIMIT 1;

-- name: UpdateCreator :exec
UPDATE creators
SET name = $2,
    profile_text = $3,
    icon_image_id = $4
WHERE id = $1;

-- name: GetCreatorImageByIDForTenant :one
SELECT civ.object_key,
    civ.content_type
FROM creator_images ci
JOIN LATERAL (
    SELECT object_key, content_type
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE ci.id = $1
    AND ci.tenant_id = $2
LIMIT 1;
