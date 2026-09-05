-- name: CreatePage :one
INSERT INTO pages (id, tenant_id, slug, title, display_in_footer)
VALUES (sqlc.arg('id'), sqlc.arg('tenant_id'), sqlc.arg('slug'), sqlc.arg('title'), sqlc.arg('display_in_footer'))
RETURNING *;

-- name: GetPageByIDForTenant :one
SELECT * FROM pages
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id');

-- Admin ListPages is (created_at, id) ASC. Forward uses the ASC query;
-- backward uses DESC so the index can be scanned in reverse. The handler
-- flips DESC rows back into display order.
-- cursor rules: proto/README.md.
-- name: ListPagesForTenantAsc :many
SELECT * FROM pages
WHERE tenant_id = sqlc.arg('tenant_id')
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

-- name: ListPagesForTenantDesc :many
SELECT * FROM pages
WHERE tenant_id = sqlc.arg('tenant_id')
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

-- name: UpdatePage :one
-- display_in_footer keeps the stored value when the argument is omitted (NULL),
-- so a title-only edit does not have to restate the footer flag.
UPDATE pages
SET title = sqlc.arg('title'),
	display_in_footer = COALESCE(sqlc.narg('display_in_footer'), display_in_footer),
	updated_at = NOW()
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: SetPagePublishedVersion :one
UPDATE pages
SET published_version_id = sqlc.narg('published_version_id'), updated_at = NOW()
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: GetMaxPageVersionNumberByPageID :one
-- The caller adds one to this to number the version it is about to create;
-- COALESCE makes the first version of a page number 1.
SELECT COALESCE(MAX(version_number), 0)::int AS max_version
FROM page_versions
WHERE page_id = sqlc.arg('page_id');

-- name: CreatePageVersion :one
INSERT INTO page_versions (id, page_id, tenant_id, version_number, content_markdown, author_user_id)
VALUES (sqlc.arg('id'), sqlc.arg('page_id'), sqlc.arg('tenant_id'), sqlc.arg('version_number'), sqlc.arg('content_markdown'), sqlc.narg('author_user_id'))
RETURNING *;

-- name: GetPageVersionByIDForPage :one
SELECT * FROM page_versions
WHERE id = sqlc.arg('id') AND page_id = sqlc.arg('page_id');

-- name: ListPageVersionsByPageID :many
SELECT * FROM page_versions
WHERE page_id = sqlc.arg('page_id')
ORDER BY version_number DESC;

-- name: PublishPageVersion :one
UPDATE page_versions
SET status = 'published', published_at = NOW()
WHERE id = sqlc.arg('id') AND page_id = sqlc.arg('page_id')
RETURNING *;

-- name: ListPublishedPagesForTenant :many
-- Restricted to the pages flagged for the footer, which is the only place a
-- reader navigates to them from.
SELECT p.*
FROM pages p
	JOIN page_versions pv ON pv.id = p.published_version_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND p.display_in_footer = true
	AND pv.status = 'published'
	AND pv.published_at IS NOT NULL
	AND pv.published_at <= NOW()
ORDER BY p.created_at ASC;

-- name: GetPublishedPageBySlugForTenant :one
SELECT p.id,
	p.tenant_id,
	p.slug,
	p.title,
	p.published_version_id,
	p.display_in_footer,
	p.created_at,
	p.updated_at,
	pv.id AS version_id,
	pv.page_id,
	pv.version_number,
	pv.content_markdown,
	pv.author_user_id,
	pv.status,
	pv.publish_at,
	pv.created_at AS version_created_at,
	pv.published_at
FROM pages p
	JOIN page_versions pv ON pv.id = p.published_version_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND p.slug = sqlc.arg('slug')
	AND pv.status = 'published'
	AND pv.published_at IS NOT NULL
	AND pv.published_at <= NOW()
LIMIT 1;
