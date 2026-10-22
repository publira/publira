-- name: GetTenantSignUpSettings :one
-- Returns no rows for a tenant that has saved nothing, which reads as sign-up
-- open with no message of its own.
SELECT *
FROM tenant_sign_up_settings
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: UpsertTenantSignUpSettings :one
-- The message arrives trimmed and within the column's length.
INSERT INTO tenant_sign_up_settings (tenant_id, sign_up_open, closed_message)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('sign_up_open'),
        sqlc.arg('closed_message')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET sign_up_open = EXCLUDED.sign_up_open,
    closed_message = EXCLUDED.closed_message,
    updated_at = NOW()
RETURNING *;
