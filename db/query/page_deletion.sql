-- Deleting a page, which the console allows only while no reader can reach it
-- and none agreed to it: no translation of it published, no legal-page setting
-- naming it, and no reader's agreement to one of its versions. Its
-- translations and their versions go with it, in the transaction that deletes
-- it.
--
-- The statements run in the order they appear here. The locks come first and
-- the check after them, in a statement of its own: READ COMMITTED freezes a
-- statement's snapshot at its start, so a check made inside the statement that
-- waited for a lock would still answer from before the wait.

-- name: LockPageForDeletion :one
-- The page, with the slug and the title the audit entry keeps once no row is
-- left to join, the title in the translation for the tenant's default locale.
-- The row lock keeps a version or a translation from being added, and the page
-- from being named as a legal page, while it is deleted: each of those writes
-- takes a key share lock on the page row through its foreign key, which waits
-- for this one and fails once it commits.
SELECT p.id,
    p.slug,
    pt.title
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.id = page_translation_for(p.id, t.default_locale)
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.id = sqlc.arg('id')
FOR UPDATE OF p;

-- name: LockPageVersionsForDeletion :exec
-- Every version of the page. A reader's agreement takes a key share lock on
-- the version it names through its foreign key, and publishing a version
-- updates its row, so either one in progress is waited for here and is seen by
-- the check, and either one that arrives later waits and then fails.
SELECT id
FROM page_versions
WHERE tenant_id = sqlc.arg('tenant_id')
    AND page_id = sqlc.arg('page_id')
FOR UPDATE;

-- name: GetPageDeletionBlocker :one
-- The first of the reasons the page has to be kept, in the order the refusal
-- names them, or '' when there is none:
--
--   published   a translation of it with a published version, in any locale
--   legal_page  the tenant names it as its terms of service or privacy policy
--   agreed_to   a reader's agreement to one of its versions
SELECT (
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM page_translations pt
                WHERE pt.tenant_id = sqlc.arg('tenant_id')
                    AND pt.page_id = sqlc.arg('page_id')::uuid
                    AND pt.published_version_id IS NOT NULL
            ) THEN 'published'
            WHEN EXISTS (
                SELECT 1
                FROM tenant_config tc
                WHERE tc.tenant_id = sqlc.arg('tenant_id')
                    AND sqlc.arg('page_id')::uuid IN (tc.terms_page_id, tc.privacy_page_id)
            ) THEN 'legal_page'
            WHEN EXISTS (
                SELECT 1
                FROM user_page_consents c
                    JOIN page_versions pv ON pv.tenant_id = c.tenant_id
                    AND pv.id = c.page_version_id
                WHERE c.tenant_id = sqlc.arg('tenant_id')
                    AND pv.page_id = sqlc.arg('page_id')::uuid
            ) THEN 'agreed_to'
            ELSE ''
        END
    )::text AS blocker;

-- name: DeletePageByIDForTenant :exec
-- The page, and through the foreign keys that cascade from it its
-- translations and their versions.
DELETE FROM pages
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');
