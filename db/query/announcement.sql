-- name: CreateAnnouncement :one
-- お知らせを作成
INSERT INTO announcements (
    id,
    tenant_id,
    target_user_id,
    announcement_type,
    title,
    body,
    link_url,
    metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- Admin ListAnnouncements は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで idx_announcements_tenant_created_at を
-- 走査し、前ページだけ handler で表示順へ戻す。ORDER BY をパラメータで分岐させると
-- 索引順に読めないため、走査方向ごとにクエリを分ける。
-- cursor の共通仕様は proto/README.md を参照。
-- name: ListAnnouncementsForTenantDesc :many
-- テナント管理画面向けお知らせ一覧（次ページ方向）
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.announcement_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM announcements n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForTenantAsc :many
-- テナント管理画面向けお知らせ一覧（前ページ方向）
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.announcement_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM announcements n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- 公開サイトの ListAnnouncements は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。ORDER BY をパラメータで分岐させると索引順に
-- 読めないため、走査方向ごとにクエリを分ける。
-- cursor の共通仕様は proto/README.md を参照。
-- name: ListAnnouncementsForUserDesc :many
-- お知らせ一覧を取得（既読状態付き・次ページ方向）
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'))
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForUserAsc :many
-- お知らせ一覧を取得（既読状態付き・前ページ方向）
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'))
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- name: GetAnnouncementForUser :one
-- お知らせ 1 件を取得（既読状態付き）。inbox に属する行だけを返す。
-- 他人・他テナントの行は 0 件になり、存在の有無は区別しない。
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.id = sqlc.arg('id')
    AND n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'));

-- name: MarkAnnouncementAsRead :one
-- 指定したお知らせを既読にする（未読時は新規作成、既読済みなら時刻更新）
INSERT INTO announcement_reads (announcement_id, user_id, read_at)
SELECT n.id, $3, NOW()
FROM announcements n
WHERE n.id = $1
    AND n.tenant_id = $2
    AND (n.target_user_id IS NULL OR n.target_user_id = $3)
ON CONFLICT (announcement_id, user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkAllAnnouncementsAsRead :execrows
-- 指定ユーザーの未読お知らせを一括既読化
INSERT INTO announcement_reads (announcement_id, user_id, read_at)
SELECT n.id, $2, NOW()
FROM announcements n
WHERE n.tenant_id = $1
    AND (n.target_user_id IS NULL OR n.target_user_id = $2)
    AND NOT EXISTS (
        SELECT 1
        FROM announcement_reads nr
        WHERE nr.announcement_id = n.id
            AND nr.user_id = $2
    )
ON CONFLICT (announcement_id, user_id) DO NOTHING;
