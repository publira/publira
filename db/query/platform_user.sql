-- name: BumpPlatformUserCredentialsVersion :one
UPDATE platform_users
SET credentials_version = credentials_version + 1
WHERE id = $1
RETURNING *;

-- name: GetPlatformUserByEmail :one
SELECT *
FROM platform_users
WHERE email = $1
LIMIT 1;

-- name: GetPlatformUserByID :one
SELECT *
FROM platform_users
WHERE id = $1
LIMIT 1;

-- name: GetPlatformUserByPublicID :one
SELECT *
FROM platform_users
WHERE public_id = $1
LIMIT 1;

-- name: CountPlatformUsers :one
-- プラットフォーム管理ユーザー数を取得する (初期セットアップ判定用)
SELECT COUNT(*)::int
FROM platform_users;

-- name: CreatePlatformUser :one
INSERT INTO platform_users (id, public_id, email, password_hash, name)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdatePlatformUserStatus :one
-- プラットフォームユーザーのステータスを更新
UPDATE platform_users
SET status = $2
WHERE public_id = $1
RETURNING *;

-- name: UpdatePlatformUserPasswordHashByID :one
UPDATE platform_users
SET password_hash = $2
WHERE id = $1
RETURNING *;

-- name: UpdatePlatformUserEmailByID :one
UPDATE platform_users
SET email = $2
WHERE id = $1
RETURNING *;

-- name: CreatePlatformUserRole :one
INSERT INTO platform_user_roles (id, platform_user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListPlatformUserRoles :many
SELECT role
FROM platform_user_roles
WHERE platform_user_id = $1
ORDER BY role;

-- Worker fan-out: every platform user that holds a role is an operator.
-- name: ListPlatformOperatorIDs :many
SELECT DISTINCT pu.id
FROM platform_users pu
    INNER JOIN platform_user_roles pur ON pur.platform_user_id = pu.id
ORDER BY pu.id;

-- Platform ListOperators は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListPlatformOperatorsDesc :many
SELECT pu.id,
    pu.public_id,
    pu.email,
    pu.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.platform_user_id = pu.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    pu.status,
    pu.created_at
FROM platform_users pu
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY pu.created_at DESC, pu.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPlatformOperatorsAsc :many
SELECT pu.id,
    pu.public_id,
    pu.email,
    pu.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.platform_user_id = pu.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    pu.status,
    pu.created_at
FROM platform_users pu
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY pu.created_at ASC, pu.id ASC
LIMIT sqlc.arg('limit');

-- name: GetPlatformOperatorByPublicID :one
SELECT pu.id,
    pu.public_id,
    pu.email,
    pu.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.platform_user_id = pu.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    pu.status,
    pu.created_at
FROM platform_users pu
WHERE pu.public_id = $1
LIMIT 1;

-- name: DeletePlatformUserRolesByPlatformUserID :exec
DELETE FROM platform_user_roles
WHERE platform_user_id = $1;

-- name: ListRecentPlatformEvents :many
SELECT event_type,
    action,
    target,
    actor,
    occurred_at
FROM (
        SELECT 'tenant_created'::text AS event_type,
            'Tenant Created'::text AS action,
            t.public_id::text AS target,
            ''::text AS actor,
            t.created_at AS occurred_at
        FROM tenants t
        UNION ALL
        SELECT 'operator_role_granted'::text AS event_type,
            'Operator Role Granted'::text AS action,
            pu.public_id::text AS target,
            ''::text AS actor,
            pur.created_at AS occurred_at
        FROM platform_user_roles pur
            JOIN platform_users pu ON pu.id = pur.platform_user_id
        UNION ALL
        SELECT 'end_user_created'::text AS event_type,
            'End User Created'::text AS action,
            u.public_id::text AS target,
            ''::text AS actor,
            u.created_at AS occurred_at
        FROM users u
        WHERE NOT EXISTS (
                SELECT 1
                FROM tenant_user_roles tur
                WHERE tur.user_id = u.id
            )
    ) events
ORDER BY occurred_at DESC
LIMIT $1;
