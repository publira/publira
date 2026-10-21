-- name: CreateAnnouncement :one
INSERT INTO announcements (
    id,
    tenant_id,
    announcement_type,
    link_url,
    metadata,
    pinned,
    pinned_until,
    delivery
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: CreateAnnouncementTranslation :one
INSERT INTO announcement_translations (
    id,
    announcement_id,
    tenant_id,
    locale,
    title,
    body
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListAnnouncementTranslations :many
-- Every translation of the announcements named, oldest first within each, for
-- the console to read back what it wrote.
SELECT *
FROM announcement_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND announcement_id = ANY(sqlc.arg('announcement_ids')::uuid [])
ORDER BY announcement_id, created_at, id;

-- name: ListAnnouncementTranslationLocales :many
-- Every locale an announcement has a translation in, in code order: the
-- language alternates of the announcement.
SELECT locale
FROM announcement_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND announcement_id = sqlc.arg('announcement_id')
ORDER BY locale;

-- name: GetAnnouncementDelivery :one
-- Worker fan-out: whether the announcement answers to its readers'
-- announcements cell ('preferred') or reaches every one of them ('everyone').
SELECT delivery
FROM announcements
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('announcement_id');

-- name: ListAnnouncementRecipients :many
-- Worker fan-out: everyone an announcement addressed to the whole tenant
-- reaches, each with the title of the translation they are told about. It is
-- the audience `ListAnnouncementsForUser*` already serves such a row to —
-- every user the tenant owns — so the bell counts what the announcements inbox
-- lists rather than a subset of it. The translation is the one the reader's
-- last locale picks, and the tenant default locale's for a reader who has none.
--
-- Keyset paging on user_id, because the result grows with the tenant's
-- readership and the caller writes one row per recipient. The pair is
-- `users_tenant_id_id_key`, so the page is one index scan. The nil UUID sorts
-- below every UUID, so it is what the first page asks for.
SELECT u.id AS user_id,
    tr.title
FROM users u
    CROSS JOIN LATERAL announcement_translation_for(sqlc.arg('announcement_id')::uuid, COALESCE(u.last_locale, '')) tr
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.id > sqlc.arg('after_user_id')
ORDER BY u.id
LIMIT sqlc.arg('limit');

-- Admin ListAnnouncements is (created_at, id) DESC. Forward uses the DESC
-- query; backward uses ASC so idx_announcements_tenant_created_at can be
-- scanned in reverse. The handler flips ASC rows back into display order.
-- A parameterized ORDER BY cannot be read in index order, so each scan
-- direction gets its own query. Each row carries the title and body of its
-- translation in the tenant default locale, else its oldest.
-- cursor rules: proto/README.md.
-- name: ListAnnouncementsForTenantDesc :many
SELECT
    n.id,
    n.tenant_id,
    n.announcement_type,
    tr.title,
    tr.body,
    n.link_url,
    n.metadata,
    n.created_at,
    n.pinned,
    n.pinned_until,
    n.delivery
FROM announcements n
    CROSS JOIN LATERAL announcement_translation_for(n.id, '') tr
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForTenantAsc :many
SELECT
    n.id,
    n.tenant_id,
    n.announcement_type,
    tr.title,
    tr.body,
    n.link_url,
    n.metadata,
    n.created_at,
    n.pinned,
    n.pinned_until,
    n.delivery
FROM announcements n
    CROSS JOIN LATERAL announcement_translation_for(n.id, '') tr
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- The public site's ListAnnouncements is (created_at, id) DESC. Forward uses
-- the DESC query; backward uses ASC so the index can be scanned in reverse.
-- The handler flips ASC rows back into display order. A parameterized
-- ORDER BY cannot be read in index order, so each scan direction gets its own
-- query. Every row carries the calling user's read state, and the title and
-- body of its translation in the locale asked for, under
-- announcement_translation_for's fallback.
-- cursor rules: proto/README.md.
-- name: ListAnnouncementsForUserDesc :many
SELECT
    n.*,
    tr.locale,
    tr.title,
    tr.body,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    CROSS JOIN LATERAL announcement_translation_for(n.id, sqlc.arg('locale')::text) tr
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.narg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForUserAsc :many
SELECT
    n.*,
    tr.locale,
    tr.title,
    tr.body,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    CROSS JOIN LATERAL announcement_translation_for(n.id, sqlc.arg('locale')::text) tr
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.narg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- name: GetAnnouncementForUser :one
-- Returns the announcement with the caller's read state, in its translation
-- for the locale asked for. A row owned by another tenant comes back as no
-- rows, so its existence is not disclosed.
SELECT
    n.*,
    tr.locale,
    tr.title,
    tr.body,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    CROSS JOIN LATERAL announcement_translation_for(n.id, sqlc.arg('locale')::text) tr
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.narg('user_id')
WHERE n.id = sqlc.arg('id')
    AND n.tenant_id = sqlc.arg('tenant_id');

-- name: MarkAnnouncementAsRead :one
-- Upserts, so marking an already-read announcement refreshes read_at instead
-- of failing. The SELECT confines the insert to the caller's own tenant.
INSERT INTO announcement_reads (announcement_id, tenant_id, user_id, read_at)
SELECT n.id, n.tenant_id, $3, NOW()
FROM announcements n
WHERE n.id = $1
    AND n.tenant_id = $2
ON CONFLICT (announcement_id, user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkAllAnnouncementsAsRead :execrows
-- Inserts a read row for every announcement of the caller's tenant that lacks
-- one.
INSERT INTO announcement_reads (announcement_id, tenant_id, user_id, read_at)
SELECT n.id, n.tenant_id, $2, NOW()
FROM announcements n
WHERE n.tenant_id = $1
    AND NOT EXISTS (
        SELECT 1
        FROM announcement_reads nr
        WHERE nr.announcement_id = n.id
            AND nr.user_id = $2
    )
ON CONFLICT (announcement_id, user_id) DO NOTHING;

-- name: GetPinnedAnnouncementForTenant :one
-- What the site shows as a banner: the newest announcement still inside its
-- pinned window, in its translation for the locale asked for. It names no
-- user, so a visitor with no session gets the same answer as a signed-in
-- reader and the site caches it once per tenant and locale.
SELECT n.*,
    tr.locale,
    tr.title,
    tr.body
FROM announcements n
    CROSS JOIN LATERAL announcement_translation_for(n.id, sqlc.arg('locale')::text) tr
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.pinned
    AND (n.pinned_until IS NULL OR n.pinned_until > NOW())
ORDER BY n.created_at DESC, n.id DESC
LIMIT 1;

-- name: UnpinAnnouncement :one
-- Takes the banner down and leaves the row where it is, so the announcement is
-- still in the list it was posted to. pinned_until keeps whatever it held, as
-- the instant the operator had planned to stop at.
UPDATE announcements
SET pinned = false
WHERE id = $1
    AND tenant_id = $2
RETURNING id;

-- name: ListPinnedAnnouncementsDue :many
-- Every announcement whose pinned window has passed, across all tenants, for
-- the ticker job that clears the flag and drops what the sites cached.
SELECT id, tenant_id
FROM announcements
WHERE pinned
    AND pinned_until IS NOT NULL
    AND pinned_until <= NOW()
ORDER BY tenant_id, id;

-- name: ClearAnnouncementPin :exec
-- The ticker job's write. It is what makes a boundary stop being due, so a run
-- that was down over one still catches up instead of collecting it.
UPDATE announcements
SET pinned = false
WHERE id = $1;
