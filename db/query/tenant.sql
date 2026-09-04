-- ListTenants は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
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
-- プラットフォーム管理者向けテナント作成
-- default_locale は列 DEFAULT を持たないため、呼び出し側が必ず明示する。timezone も
-- 列の DEFAULT に任せず、プラットフォーム既定値を明示的に適用する
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, timezone, default_locale)
VALUES (sqlc.arg('id'), sqlc.arg('public_id'), sqlc.arg('domain'), sqlc.narg('admin_domain'), sqlc.arg('name'), 'active', sqlc.arg('timezone'), sqlc.arg('default_locale'))
RETURNING *;

-- name: UpdateTenantStatus :one
-- テナントの状態 (active / suspended) を更新する
UPDATE tenants
SET status = $2
WHERE public_id = $1
RETURNING *;

-- name: UpdateTenantInfo :one
-- テナントの名前・ドメインを更新する
UPDATE tenants
SET name = sqlc.arg('name'), domain = sqlc.arg('domain'), admin_domain = sqlc.narg('admin_domain')
WHERE public_id = sqlc.arg('public_id')
RETURNING *;

-- name: UpdateTenantTimezone :one
-- テナントの表示タイムゾーン (IANA 名) を更新する
UPDATE tenants
SET timezone = sqlc.arg('timezone')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: UpdateTenantDefaultLocale :one
-- テナントの既定ロケールを更新する
UPDATE tenants
SET default_locale = sqlc.arg('default_locale')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: GetTenantByDomains :one
-- 候補ホスト名の順序を保ったまま最初に一致したテナントを返す
SELECT t.*
FROM unnest(sqlc.arg('domains')::text[]) WITH ORDINALITY AS candidate(domain, ord)
JOIN tenants t ON t.domain = candidate.domain
ORDER BY candidate.ord
LIMIT 1;

-- name: GetAdminTenantByDomains :one
-- 候補ホスト名の順序を保ったまま admin_domain、または admin.{domain} フォールバックで一致したテナントを返す
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
-- ユーザーが所属するテナントを取得
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
