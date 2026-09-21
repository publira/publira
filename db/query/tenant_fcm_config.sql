-- name: GetTenantFcmConfig :one
-- Returns no rows for a tenant that has no Firebase credentials, which is the
-- whole "mobile push is disabled" state.
SELECT *
FROM tenant_fcm_config
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: UpsertTenantFcmConfig :one
INSERT INTO tenant_fcm_config (
        tenant_id,
        project_id,
        client_email,
        service_account_json_encrypted
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('project_id'),
        sqlc.arg('client_email'),
        sqlc.arg('service_account_json_encrypted')
    )
ON CONFLICT (tenant_id) DO UPDATE
SET project_id = EXCLUDED.project_id,
    client_email = EXCLUDED.client_email,
    service_account_json_encrypted = EXCLUDED.service_account_json_encrypted,
    updated_at = NOW()
RETURNING *;

-- name: DeleteTenantFcmConfig :execrows
DELETE FROM tenant_fcm_config
WHERE tenant_id = sqlc.arg('tenant_id');
