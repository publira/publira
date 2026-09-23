-- name: ListPublishedPageVersionsByIDsForTenant :many
-- The versions among the given ids that the tenant has published, current or
-- superseded, each with its page. A draft is left out: no reader was shown it.
SELECT id, page_id
FROM page_versions
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = ANY(sqlc.arg('ids')::uuid[])
    AND status = 'published';

-- name: CreateUserPageConsent :exec
INSERT INTO user_page_consents (tenant_id, user_id, page_version_id)
VALUES (sqlc.arg('tenant_id'), sqlc.arg('user_id'), sqlc.arg('page_version_id'));

