-- name: GetTenantEmailRejectionSettings :one
-- Returns no rows for a tenant that has saved nothing, which reads as the
-- disposable-domain list off.
SELECT *
FROM tenant_email_rejection_settings
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: UpsertTenantEmailRejectionSettings :one
INSERT INTO tenant_email_rejection_settings (tenant_id, reject_disposable_domains)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('reject_disposable_domains')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET reject_disposable_domains = EXCLUDED.reject_disposable_domains,
    updated_at = NOW()
RETURNING *;

-- name: ListTenantEmailRejectionEntries :many
SELECT entry
FROM tenant_email_rejection_entries
WHERE tenant_id = sqlc.arg('tenant_id')
ORDER BY entry;

-- name: DeleteTenantEmailRejectionEntries :exec
DELETE FROM tenant_email_rejection_entries
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: InsertTenantEmailRejectionEntries :exec
-- The entries arrive validated, lowercased, and without duplicates.
INSERT INTO tenant_email_rejection_entries (tenant_id, entry)
SELECT sqlc.arg('tenant_id'),
    unnest(sqlc.arg('entries')::text[]);
