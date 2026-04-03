-- name: CreatePage :one
-- ページを新規作成する
INSERT INTO pages (id, tenant_id, slug, title)
VALUES (sqlc.arg('id'), sqlc.arg('tenant_id'), sqlc.arg('slug'), sqlc.arg('title'))
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

-- name: UpdatePageTitle :one
-- ページのタイトルを更新する
UPDATE pages
SET title = sqlc.arg('title'), updated_at = NOW()
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
INSERT INTO page_versions (id, page_id, version_number, content_markdown, author_user_id)
VALUES (sqlc.arg('id'), sqlc.arg('page_id'), sqlc.arg('version_number'), sqlc.arg('content_markdown'), sqlc.narg('author_user_id'))
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
