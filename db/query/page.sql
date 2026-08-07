-- name: CreatePage :one
-- ページを新規作成する
INSERT INTO pages (id, tenant_id, slug, title, display_in_footer)
VALUES (sqlc.arg('id'), sqlc.arg('tenant_id'), sqlc.arg('slug'), sqlc.arg('title'), sqlc.arg('display_in_footer'))
RETURNING *;

-- name: GetPageByIDForTenant :one
-- テナントのページをIDで取得する
SELECT * FROM pages
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id');

-- name: ListPagesForTenant :many
-- テナントのページ一覧を取得する（作成日昇順）
SELECT * FROM pages
WHERE tenant_id = sqlc.arg('tenant_id')
ORDER BY created_at ASC;

-- name: UpdatePage :one
-- ページのタイトルとフッター表示設定を更新する
UPDATE pages
SET title = sqlc.arg('title'),
	display_in_footer = sqlc.arg('display_in_footer'),
	updated_at = NOW()
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: SetPagePublishedVersion :one
-- ページの公開バージョンIDを更新する
UPDATE pages
SET published_version_id = sqlc.narg('published_version_id'), updated_at = NOW()
WHERE id = sqlc.arg('id') AND tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: GetMaxPageVersionNumberByPageID :one
-- ページの最大バージョン番号を取得する（次バージョン番号算出用）
SELECT COALESCE(MAX(version_number), 0)::int AS max_version
FROM page_versions
WHERE page_id = sqlc.arg('page_id');

-- name: CreatePageVersion :one
-- ページバージョンを新規作成する
INSERT INTO page_versions (id, page_id, tenant_id, version_number, content_markdown, author_user_id)
VALUES (sqlc.arg('id'), sqlc.arg('page_id'), sqlc.arg('tenant_id'), sqlc.arg('version_number'), sqlc.arg('content_markdown'), sqlc.narg('author_user_id'))
RETURNING *;

-- name: GetPageVersionByIDForPage :one
-- ページバージョンをIDで取得する
SELECT * FROM page_versions
WHERE id = sqlc.arg('id') AND page_id = sqlc.arg('page_id');

-- name: ListPageVersionsByPageID :many
-- ページのバージョン一覧を新しい順に取得する
SELECT * FROM page_versions
WHERE page_id = sqlc.arg('page_id')
ORDER BY version_number DESC;

-- name: PublishPageVersion :one
-- ページバージョンを公開状態にする
UPDATE page_versions
SET status = 'published', published_at = NOW()
WHERE id = sqlc.arg('id') AND page_id = sqlc.arg('page_id')
RETURNING *;

-- name: ListPublishedPagesForTenant :many
-- テナントの公開中かつフッター表示対象のページ一覧を取得する
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
-- テナントの公開中ページをslugで取得する
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
