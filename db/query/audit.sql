-- name: InsertAdminAuditLog :exec
-- 管理操作監査ログを記録する
INSERT INTO admin_audit_logs (
    id,
    actor_user_public_id,
    actor_role,
    tenant_public_id,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    client_ip
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: ListAdminAuditLogs :many
-- 管理操作監査ログ一覧取得（フィルタ対応）
SELECT a.id,
    a.actor_user_public_id,
    a.actor_role,
    a.tenant_public_id,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_u.name, ''::text) AS actor_name,
    COALESCE(tenant_t.name, ''::text) AS tenant_name,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.name, ''::text)
        WHEN a.target_type IN ('user', 'operator') THEN COALESCE(target_u.name, ''::text)
        ELSE ''::text
    END AS target_name
FROM admin_audit_logs a
    LEFT JOIN users actor_u ON actor_u.public_id = a.actor_user_public_id
    LEFT JOIN tenants tenant_t ON tenant_t.public_id = a.tenant_public_id
    LEFT JOIN users target_u ON target_u.public_id = a.target_id
    AND a.target_type IN ('user', 'operator')
    LEFT JOIN tenants target_t ON target_t.public_id = a.target_id
    AND a.target_type = 'tenant'
WHERE (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR a.actor_user_public_id = sqlc.narg('filter_actor_user_public_id')::text)
  AND (sqlc.narg('filter_tenant_public_id')::text IS NULL OR a.tenant_public_id = sqlc.narg('filter_tenant_public_id')::text)
  AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
ORDER BY a.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');
