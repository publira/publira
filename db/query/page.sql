-- name: CreatePage :one
-- The caller creates the page's default-locale translation in the same
-- transaction, so no page is ever stored without one.
INSERT INTO pages (id, tenant_id, slug, display_in_footer)
VALUES (sqlc.arg('id'), sqlc.arg('tenant_id'), sqlc.arg('slug'), sqlc.arg('display_in_footer'))
RETURNING *;

-- name: CreatePageTranslation :one
INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
VALUES (sqlc.arg('id'), sqlc.arg('page_id'), sqlc.arg('tenant_id'), sqlc.arg('locale'), sqlc.arg('title'))
RETURNING *;

-- name: GetPageByIDForTenant :one
-- The page with the translation page_translation_for picks for the locale.
SELECT sqlc.embed(p), sqlc.embed(pt)
FROM pages p
	JOIN page_translations pt ON pt.id = page_translation_for(p.id, sqlc.arg('locale'))
WHERE p.id = sqlc.arg('id')
	AND p.tenant_id = sqlc.arg('tenant_id');

-- name: GetPageWithTranslationForTenant :one
-- The page with its translation in exactly this locale, and no row when the
-- page has none: an edit aimed at one language must not land on another.
SELECT sqlc.embed(p), sqlc.embed(pt)
FROM pages p
	JOIN page_translations pt ON pt.page_id = p.id
	AND pt.locale = sqlc.arg('locale')
WHERE p.id = sqlc.arg('id')
	AND p.tenant_id = sqlc.arg('tenant_id');

-- name: ListPageTranslationsForTenant :many
-- Empty only for a page the tenant does not have, since a page always keeps at
-- least one translation.
SELECT *
FROM page_translations
WHERE page_id = sqlc.arg('page_id')
	AND tenant_id = sqlc.arg('tenant_id')
ORDER BY created_at ASC, id ASC;

-- name: LockPageForTenant :one
-- Serializes the writers that must not leave a page without a translation.
SELECT id
FROM pages
WHERE id = sqlc.arg('id')
	AND tenant_id = sqlc.arg('tenant_id')
FOR UPDATE;

-- name: CountPageTranslations :one
SELECT count(*)::int AS translations
FROM page_translations
WHERE page_id = sqlc.arg('page_id');

-- name: DeletePageTranslation :one
-- The translation's versions go with it (page_versions_tenant_page_translation_id_fkey).
DELETE FROM page_translations
WHERE id = sqlc.arg('id')
	AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- Admin ListPages is (created_at, id) ASC. Forward uses the ASC query;
-- backward uses DESC so the index can be scanned in reverse. The handler
-- flips DESC rows back into display order.
-- cursor rules: proto/README.md.
-- name: ListPagesForTenantAsc :many
SELECT sqlc.embed(p), sqlc.embed(pt)
FROM pages p
	JOIN page_translations pt ON pt.id = page_translation_for(p.id, sqlc.arg('locale'))
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND (
		sqlc.narg('cursor_id')::uuid IS NULL
		OR (
			sqlc.arg('cursor_inclusive')::boolean
			AND (p.created_at, p.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
		)
		OR (
			NOT sqlc.arg('cursor_inclusive')::boolean
			AND (p.created_at, p.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
		)
	)
ORDER BY p.created_at ASC, p.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPagesForTenantDesc :many
SELECT sqlc.embed(p), sqlc.embed(pt)
FROM pages p
	JOIN page_translations pt ON pt.id = page_translation_for(p.id, sqlc.arg('locale'))
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND (
		sqlc.narg('cursor_id')::uuid IS NULL
		OR (
			sqlc.arg('cursor_inclusive')::boolean
			AND (p.created_at, p.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
		)
		OR (
			NOT sqlc.arg('cursor_inclusive')::boolean
			AND (p.created_at, p.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
		)
	)
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit');

-- name: UpdatePage :one
-- display_in_footer keeps the stored value when the argument is omitted (NULL),
-- so a title-only edit does not have to restate the footer flag.
UPDATE pages
SET display_in_footer = COALESCE(sqlc.narg('display_in_footer'), display_in_footer),
	updated_at = NOW()
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: UpdatePageTranslationTitle :one
UPDATE page_translations
SET title = sqlc.arg('title'), updated_at = NOW()
WHERE id = sqlc.arg('id')
	AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: SetPageTranslationPublishedVersion :one
UPDATE page_translations
SET published_version_id = sqlc.narg('published_version_id'), updated_at = NOW()
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: GetMaxPageVersionNumberByTranslationID :one
-- The caller adds one to this to number the version it is about to create;
-- COALESCE makes the first version of a translation number 1.
SELECT COALESCE(MAX(version_number), 0)::int AS max_version
FROM page_versions
WHERE translation_id = sqlc.arg('translation_id');

-- name: CreatePageVersion :one
INSERT INTO page_versions (id, page_id, translation_id, tenant_id, version_number, content_markdown, author_user_id)
VALUES (sqlc.arg('id'), sqlc.arg('page_id'), sqlc.arg('translation_id'), sqlc.arg('tenant_id'), sqlc.arg('version_number'), sqlc.arg('content_markdown'), sqlc.narg('author_user_id'))
RETURNING *;

-- name: GetPageVersionByIDForTranslation :one
SELECT * FROM page_versions
WHERE id = sqlc.arg('id') AND translation_id = sqlc.arg('translation_id');

-- name: ListPageVersionsByTranslationID :many
SELECT * FROM page_versions
WHERE translation_id = sqlc.arg('translation_id')
ORDER BY version_number DESC;

-- name: PublishPageVersion :one
UPDATE page_versions
SET status = 'published', published_at = NOW()
WHERE id = sqlc.arg('id') AND translation_id = sqlc.arg('translation_id')
RETURNING *;

-- name: ListPublishedPagesForTenant :many
-- Restricted to the pages flagged for the footer, which is the only place a
-- reader navigates to them from. Each page is listed in the translation
-- published_page_translation_for picks for the reader's locale.
SELECT sqlc.embed(p), sqlc.embed(pt)
FROM pages p
	JOIN page_translations pt ON pt.id = published_page_translation_for(p.id, sqlc.arg('locale'))
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND p.display_in_footer = true
ORDER BY p.created_at ASC;

-- name: ListPublishedPageSlugsForTenant :many
-- Every published page, footer or not: the public site routes a path to a page
-- by this set, so a page left out of the footer is still reachable at its slug.
-- A page with any published translation is served in every locale, so the
-- locale handed to published_page_translation_for does not matter here.
SELECT p.slug
FROM pages p
	JOIN tenants t ON t.id = p.tenant_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND published_page_translation_for(p.id, t.default_locale) IS NOT NULL
ORDER BY p.slug ASC;

-- name: GetPublishedPageBySlugForTenant :one
-- Served in the translation ListPublishedPagesForTenant lists, and names its
-- locale so the reader can be told when it is not the one asked for.
SELECT p.id,
	p.tenant_id,
	p.slug,
	pt.locale,
	pt.title,
	pt.published_version_id,
	p.display_in_footer,
	p.created_at,
	p.updated_at,
	pt.updated_at AS translation_updated_at,
	pv.id AS version_id,
	pv.page_id,
	pv.version_number,
	pv.content_markdown,
	pv.author_user_id,
	pv.status,
	pv.publish_at,
	pv.created_at AS version_created_at,
	pv.published_at,
	-- A translation is published exactly when it is the one chosen for its own
	-- locale.
	ARRAY(
		SELECT alternate.locale
		FROM page_translations alternate
		WHERE alternate.page_id = p.id
			AND published_page_translation_for(p.id, alternate.locale) = alternate.id
		ORDER BY alternate.locale
	)::text [] AS published_locales
FROM pages p
	JOIN page_translations pt ON pt.id = published_page_translation_for(p.id, sqlc.arg('locale'))
	JOIN page_versions pv ON pv.id = pt.published_version_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
	AND p.slug = sqlc.arg('slug');
