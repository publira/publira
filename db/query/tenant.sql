-- ListTenants is (created_at, id) DESC. Forward uses the DESC query;
-- backward uses ASC so the index can be scanned in reverse. The handler
-- flips ASC rows back into display order.
-- cursor rules: proto/README.md.
-- name: ListTenantsDesc :many
SELECT *
FROM tenants
WHERE (sqlc.narg('filter_name')::text = '' OR name ILIKE '%' || sqlc.narg('filter_name')::text || '%')
  AND (sqlc.narg('filter_public_id')::text = '' OR public_id ILIKE '%' || sqlc.narg('filter_public_id')::text || '%')
  AND (sqlc.narg('filter_status')::text = '' OR status = sqlc.narg('filter_status')::text)
  AND (
    sqlc.narg('cursor_id')::uuid IS NULL
    OR (
      sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
    OR (
      NOT sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
  )
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantsAsc :many
SELECT *
FROM tenants
WHERE (sqlc.narg('filter_name')::text = '' OR name ILIKE '%' || sqlc.narg('filter_name')::text || '%')
  AND (sqlc.narg('filter_public_id')::text = '' OR public_id ILIKE '%' || sqlc.narg('filter_public_id')::text || '%')
  AND (sqlc.narg('filter_status')::text = '' OR status = sqlc.narg('filter_status')::text)
  AND (
    sqlc.narg('cursor_id')::uuid IS NULL
    OR (
      sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
    OR (
      NOT sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
  )
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg('limit');

-- name: CreateTenant :one
-- Tenant creation for platform administrators.
-- default_locale has no column DEFAULT, so the caller always passes it
-- explicitly. timezone is not left to its column DEFAULT either: the
-- platform default is applied explicitly.
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, timezone, default_locale)
VALUES (sqlc.arg('id'), sqlc.arg('public_id'), sqlc.arg('domain'), sqlc.narg('admin_domain'), sqlc.arg('name'), 'active', sqlc.arg('timezone'), sqlc.arg('default_locale'))
RETURNING *;

-- name: UpdateTenantStatus :one
-- Update the tenant status (active / suspended).
UPDATE tenants
SET status = $2
WHERE public_id = $1
RETURNING *;

-- name: UpdateTenantInfo :one
-- Update the tenant name and its domains.
UPDATE tenants
SET name = sqlc.arg('name'), domain = sqlc.arg('domain'), admin_domain = sqlc.narg('admin_domain')
WHERE public_id = sqlc.arg('public_id')
RETURNING *;

-- name: UpdateTenantTimezone :one
-- Update the tenant display time zone (an IANA name).
UPDATE tenants
SET timezone = sqlc.arg('timezone')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: UpdateTenantDefaultLocale :one
UPDATE tenants
SET default_locale = sqlc.arg('default_locale')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: GetTenantByDomains :one
-- Return the first tenant that matches, keeping the order of the candidate
-- host names.
SELECT t.*
FROM unnest(sqlc.arg('domains')::text[]) WITH ORDINALITY AS candidate(domain, ord)
JOIN tenants t ON t.domain = candidate.domain
ORDER BY candidate.ord
LIMIT 1;

-- name: GetAdminTenantByDomains :one
-- Return the first tenant that matches admin_domain, or the admin.{domain}
-- fallback, keeping the order of the candidate host names.
SELECT t.*
FROM unnest(sqlc.arg('domains')::text[]) WITH ORDINALITY AS candidate(domain, ord)
JOIN tenants t
    ON t.admin_domain = candidate.domain
    OR (
        t.admin_domain IS NULL
        AND candidate.domain = CONCAT('admin.', t.domain)
    )
ORDER BY candidate.ord
LIMIT 1;

-- name: LockTenantForUpdate :one
-- Lock the tenant row so concurrent tenant branding image uploads and deletes
-- (icon, logo) serialize. The following read of the current image must be a
-- separate statement: READ COMMITTED freezes its snapshot at statement start,
-- so waiting for the lock in the same statement would still see the pre-wait
-- row.
SELECT id
FROM tenants
WHERE id = $1
FOR UPDATE;

-- name: CountAllTenants :one
SELECT COUNT(*)::int
FROM tenants;

-- name: CountActiveTenants :one
SELECT COUNT(*)::int
FROM tenants
WHERE status = 'active';

-- name: CountSuspendedTenants :one
SELECT COUNT(*)::int
FROM tenants
WHERE status = 'suspended';

-- name: GetTenantByPublicID :one
SELECT *
FROM tenants
WHERE public_id = $1
LIMIT 1;

-- name: GetTenantByID :one
SELECT *
FROM tenants
WHERE id = $1
LIMIT 1;

-- name: GetTenantByUserID :one
SELECT t.id,
    t.public_id,
    t.name,
    t.created_at
FROM tenants t
    JOIN users u ON u.tenant_id = t.id
WHERE u.id = $1
LIMIT 1;

-- name: GetTenantConfigByTenantID :one
SELECT *
FROM tenant_config
WHERE tenant_id = $1
LIMIT 1;

-- name: CreateTenantConfig :one
INSERT INTO tenant_config (tenant_id, copyright_text, site_description, site_tagline)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateTenantConfig :one
UPDATE tenant_config
SET copyright_text = $2, site_description = $3, site_tagline = $4, updated_at = NOW()
WHERE tenant_id = $1
RETURNING *;

-- name: UpsertTenantCommentMode :one
-- The settings screen can save the comment mode for a tenant whose config row
-- does not exist yet, so the mode is written without disturbing the site copy
-- columns UpdateTenantConfig owns.
INSERT INTO tenant_config (tenant_id, comment_mode)
VALUES ($1, $2)
ON CONFLICT (tenant_id) DO UPDATE
SET comment_mode = EXCLUDED.comment_mode, updated_at = NOW()
RETURNING *;
