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
SELECT *
FROM admin_audit_logs
WHERE (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR actor_user_public_id = sqlc.narg('filter_actor_user_public_id')::text)
  AND (sqlc.narg('filter_tenant_public_id')::text IS NULL OR tenant_public_id = sqlc.narg('filter_tenant_public_id')::text)
  AND (sqlc.narg('filter_action')::text IS NULL OR action = sqlc.narg('filter_action')::text)
ORDER BY created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');
