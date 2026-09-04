-- name: BumpUserCredentialsVersion :one
UPDATE users
SET credentials_version = credentials_version + 1
WHERE id = $1
RETURNING *;

-- name: GetUserByEmailForTenant :one
SELECT *
FROM users
WHERE tenant_id = $1
    AND email = $2
LIMIT 1;

-- name: GetUserByID :one
SELECT *
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (id, tenant_id, public_id, email, password_hash, name)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateTenantUserRole :one
INSERT INTO tenant_user_roles (id, tenant_id, user_id, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListTenantUserRoles :many
-- テナントユーザーのロール一覧を取得する
SELECT role
FROM tenant_user_roles
WHERE user_id = $1
ORDER BY role;

-- Worker fan-out: every user that holds a tenant_user_roles row is a
-- tenant admin for that tenant. DISTINCT so one person with two roles
-- is still one notification.
-- name: ListTenantAdminIDs :many
SELECT DISTINCT tur.user_id
FROM tenant_user_roles tur
WHERE tur.tenant_id = sqlc.arg('tenant_id')::uuid
ORDER BY tur.user_id;

-- Worker fan-out: members are tenant users that do not hold a tenant role.
-- name: ListTenantMemberIDs :many
SELECT u.id
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')::uuid
    AND NOT EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
ORDER BY u.id;

-- name: CountPendingEndUsers :one
SELECT COUNT(*)::int
FROM users u
WHERE u.status = 'inactive'
    AND NOT EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    );

-- ListEndUsers はエンドユーザー（tenant_user_roles 未保持）の一覧を
-- (created_at, id) の降順で表示する。テナントメンバーは意図的に含めない。
-- プラットフォームのユーザー一覧はこの結果が完全な集合であり、クライアントが
-- ListTenantMembers で補完しない。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListEndUsersDesc :many
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at,
    COALESCE(t.public_id, ''::text) AS tenant_public_id,
    COALESCE(t.name, ''::text) AS tenant_name
FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (sqlc.narg('created_after')::timestamptz IS NULL OR u.created_at >= sqlc.narg('created_after')::timestamptz)
    AND (sqlc.narg('created_before')::timestamptz IS NULL OR u.created_at <= sqlc.narg('created_before')::timestamptz)
    AND (
        sqlc.narg('status')::text IS NULL
        OR sqlc.narg('status')::text = ''
        OR u.status = sqlc.narg('status')::text
    )
    AND (sqlc.narg('public_ids')::text[] IS NULL OR u.public_id = ANY(sqlc.narg('public_ids')::text[]))
    AND (
        sqlc.narg('tenant_public_id')::text IS NULL
        OR sqlc.narg('tenant_public_id')::text = ''
        OR t.public_id = sqlc.narg('tenant_public_id')::text
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at DESC, u.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEndUsersAsc :many
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at,
    COALESCE(t.public_id, ''::text) AS tenant_public_id,
    COALESCE(t.name, ''::text) AS tenant_name
FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (sqlc.narg('created_after')::timestamptz IS NULL OR u.created_at >= sqlc.narg('created_after')::timestamptz)
    AND (sqlc.narg('created_before')::timestamptz IS NULL OR u.created_at <= sqlc.narg('created_before')::timestamptz)
    AND (
        sqlc.narg('status')::text IS NULL
        OR sqlc.narg('status')::text = ''
        OR u.status = sqlc.narg('status')::text
    )
    AND (sqlc.narg('public_ids')::text[] IS NULL OR u.public_id = ANY(sqlc.narg('public_ids')::text[]))
    AND (
        sqlc.narg('tenant_public_id')::text IS NULL
        OR sqlc.narg('tenant_public_id')::text = ''
        OR t.public_id = sqlc.narg('tenant_public_id')::text
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at ASC, u.id ASC
LIMIT sqlc.arg('limit');

-- Platform ListTenantMembers はテナントに所属する管理・編集ユーザーを
-- (created_at, id) の降順で表示する。admin の ListTenantUsers とは列が違う
-- （こちらはメール・ステータスも返し、検索の絞り込みを持たない）ので別のクエリ。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListTenantMembersDesc :many
SELECT u.id AS user_id,
    u.public_id,
    u.name,
    u.email,
    COALESCE(
        (
            SELECT tur.role
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
            ORDER BY CASE
                    WHEN tur.role = 'tenant_admin' THEN 3
                    WHEN tur.role = 'tenant_editor' THEN 2
                    WHEN tur.role = 'tenant_auditor' THEN 1
                    ELSE 0
                END DESC,
                tur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.status,
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at DESC, u.id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantMembersAsc :many
SELECT u.id AS user_id,
    u.public_id,
    u.name,
    u.email,
    COALESCE(
        (
            SELECT tur.role
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
            ORDER BY CASE
                    WHEN tur.role = 'tenant_admin' THEN 3
                    WHEN tur.role = 'tenant_editor' THEN 2
                    WHEN tur.role = 'tenant_auditor' THEN 1
                    ELSE 0
                END DESC,
                tur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.status,
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at ASC, u.id ASC
LIMIT sqlc.arg('limit');

-- Admin ListTenantUsers は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- 絞り込みは SQL 側で行う。handler で取得済みの 1 ページ分だけを突き合わせると、
-- その先のページにいる該当ユーザーが検索結果から丸ごと落ちる。
-- name: ListTenantUsersDesc :many
-- テナントに所属する管理・編集ユーザー一覧（次ページ方向）
SELECT u.id AS user_id,
    u.public_id,
    u.name,
    COALESCE(
        (
            SELECT tur.role
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
            ORDER BY CASE
                    WHEN tur.role = 'tenant_admin' THEN 3
                    WHEN tur.role = 'tenant_editor' THEN 2
                    WHEN tur.role = 'tenant_auditor' THEN 1
                    ELSE 0
                END DESC,
                tur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('query')::text IS NULL
        OR strpos(lower(u.public_id), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.name), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.email), lower(sqlc.narg('query')::text)) > 0
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at DESC, u.id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantUsersAsc :many
-- テナントに所属する管理・編集ユーザー一覧（前ページ方向）
SELECT u.id AS user_id,
    u.public_id,
    u.name,
    COALESCE(
        (
            SELECT tur.role
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
            ORDER BY CASE
                    WHEN tur.role = 'tenant_admin' THEN 3
                    WHEN tur.role = 'tenant_editor' THEN 2
                    WHEN tur.role = 'tenant_auditor' THEN 1
                    ELSE 0
                END DESC,
                tur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('query')::text IS NULL
        OR strpos(lower(u.public_id), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.name), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.email), lower(sqlc.narg('query')::text)) > 0
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at ASC, u.id ASC
LIMIT sqlc.arg('limit');

-- name: DeleteTenantUserRolesByUserID :exec
-- テナントユーザーのロールをすべて削除する
DELETE FROM tenant_user_roles
WHERE user_id = $1;

-- name: GetUserByPublicID :one
-- public_idでテナントユーザーを取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.tenant_id,
    u.created_at
FROM users u
WHERE u.public_id = $1
LIMIT 1;

-- name: GetUserByPublicIDForTenant :one
-- テナントスコープで public_id からユーザーを取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.tenant_id,
    u.created_at
FROM users u
WHERE u.tenant_id = $1
    AND u.public_id = $2
LIMIT 1;

-- name: UpdateUserStatus :one
-- ユーザーのステータスを更新
UPDATE users
SET status = $2
WHERE public_id = $1
RETURNING *;

-- name: UpdateUserStatusByID :one
-- ユーザーのステータスをID指定で更新
UPDATE users
SET status = $2
WHERE id = $1
RETURNING *;

-- name: UpdateUserEmailVerifiedAtByID :one
-- ユーザーのメール確認日時を更新
UPDATE users
SET email_verified_at = $2
WHERE id = $1
RETURNING *;

-- name: UpdateUserEmailByID :one
-- ユーザーのメールアドレスをID指定で更新
UPDATE users
SET email = $2
WHERE id = $1
RETURNING *;

-- name: UpdateUserPasswordHashByID :one
-- ユーザーのパスワードハッシュをID指定で更新
UPDATE users
SET password_hash = $2
WHERE id = $1
RETURNING *;

-- name: DeleteUserByID :exec
-- ユーザーを物理削除（外部キー制約により関連データも削除）
DELETE FROM users
WHERE id = $1;

-- name: UpdateUserNameByID :one
-- ユーザーの表示名をID指定で更新
UPDATE users
SET name = $2
WHERE id = $1
RETURNING *;

-- name: GetUserNotificationSettings :one
-- ユーザーの通知設定を取得
SELECT *
FROM user_notification_settings
WHERE user_id = $1
LIMIT 1;

-- name: UpsertUserNotificationSettings :one
-- ユーザーの通知設定を作成または更新
INSERT INTO user_notification_settings (user_id, email_notifications_enabled, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (user_id) DO UPDATE
SET email_notifications_enabled = EXCLUDED.email_notifications_enabled,
    updated_at = NOW()
RETURNING *;
