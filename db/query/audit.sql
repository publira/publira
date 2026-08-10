-- name: InsertPlatformAuditLog :exec
-- 管理操作監査ログを記録する
INSERT INTO platform_audit_logs (
    id,
    actor_platform_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    client_ip
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: InsertAuditLog :exec
-- テナント操作監査ログを記録する
INSERT INTO audit_logs (
    id,
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    client_ip
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: ListPlatformAuditLogs :many
-- 管理操作監査ログ一覧取得（フィルタ対応）
SELECT a.id,
    a.actor_platform_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_pu.name, ''::text) AS actor_name,
    COALESCE(actor_pu.public_id, ''::text) AS actor_public_id,
    COALESCE(target_t.name, ''::text) AS tenant_name,
    COALESCE(target_t.public_id, ''::text) AS tenant_public_id,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.public_id, ''::text)
        WHEN a.target_type = 'operator' THEN COALESCE(target_pu.public_id, ''::text)
        WHEN a.target_type = 'user' THEN COALESCE(target_u.public_id, ''::text)
        ELSE ''::text
    END AS target_public_id,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.name, ''::text)
        WHEN a.target_type = 'operator' THEN COALESCE(target_pu.name, ''::text)
        WHEN a.target_type = 'user' THEN COALESCE(target_u.name, ''::text)
        ELSE ''::text
    END AS target_name
FROM platform_audit_logs a
    LEFT JOIN platform_users actor_pu ON actor_pu.id = a.actor_platform_user_id
    LEFT JOIN platform_users target_pu ON target_pu.id::text = a.target_id
    AND a.target_type = 'operator'
    LEFT JOIN users target_u ON target_u.id::text = a.target_id
    AND a.target_type = 'user'
    LEFT JOIN tenants target_t ON target_t.id::text = a.target_id
    AND a.target_type = 'tenant'
WHERE (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR actor_pu.public_id = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_tenant_public_id')::text IS NULL OR (a.target_type = 'tenant' AND target_t.public_id = sqlc.narg('filter_tenant_public_id')::text))
  AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
ORDER BY a.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- ListAuditLogs は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。ORDER BY をパラメータで分岐させると索引順に
-- 読めないため、走査方向ごとにクエリを分ける。
-- cursor の共通仕様は proto/README.md を参照。
-- name: ListAuditLogsByTenantDesc :many
SELECT a.id,
    a.tenant_id,
    a.actor_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_u.public_id, ''::text) AS actor_public_id,
    COALESCE(actor_u.name, ''::text) AS actor_name
FROM audit_logs a
    LEFT JOIN users actor_u ON actor_u.id = a.actor_user_id
WHERE a.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR actor_u.public_id = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
    AND (sqlc.narg('filter_created_from')::timestamptz IS NULL OR a.created_at >= sqlc.narg('filter_created_from')::timestamptz)
    AND (sqlc.narg('filter_created_to')::timestamptz IS NULL OR a.created_at < sqlc.narg('filter_created_to')::timestamptz)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (a.created_at, a.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAuditLogsByTenantAsc :many
SELECT a.id,
    a.tenant_id,
    a.actor_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_u.public_id, ''::text) AS actor_public_id,
    COALESCE(actor_u.name, ''::text) AS actor_name
FROM audit_logs a
    LEFT JOIN users actor_u ON actor_u.id = a.actor_user_id
WHERE a.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR actor_u.public_id = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
    AND (sqlc.narg('filter_created_from')::timestamptz IS NULL OR a.created_at >= sqlc.narg('filter_created_from')::timestamptz)
    AND (sqlc.narg('filter_created_to')::timestamptz IS NULL OR a.created_at < sqlc.narg('filter_created_to')::timestamptz)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (a.created_at, a.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
ORDER BY a.created_at ASC, a.id ASC
LIMIT sqlc.arg('limit');
