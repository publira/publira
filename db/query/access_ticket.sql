-- name: CreateAccessTicket :one
INSERT INTO access_tickets (
        id,
        tenant_id,
        public_id,
        episode_id,
        user_id,
        expires_at,
        note,
        created_by_user_id
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at;

-- name: GetAccessTicketByPublicIDForTenant :one
SELECT at.id,
    at.tenant_id,
    at.public_id,
    at.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    at.user_id,
    u.public_id AS user_public_id,
    u.name AS user_name,
    u.email AS user_email,
    at.expires_at,
    at.revoked_at,
    at.note,
    at.created_by_user_id,
    at.created_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN users u ON u.id = at.user_id
WHERE at.tenant_id = $1
    AND at.public_id = $2
LIMIT 1;

-- Admin ListAccessTickets は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで idx_access_tickets_tenant_created_at
-- を走査し、前ページだけ handler で表示順へ戻す。id は UUIDv7 なので created_at
-- が同着でも並びが一意に決まる。cursor の共通仕様は proto/README.md を参照。
-- name: ListAccessTicketsForTenantDesc :many
SELECT at.id,
    at.tenant_id,
    at.public_id,
    at.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    at.user_id,
    u.public_id AS user_public_id,
    u.name AS user_name,
    u.email AS user_email,
    at.expires_at,
    at.revoked_at,
    at.note,
    at.created_by_user_id,
    at.created_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN users u ON u.id = at.user_id
WHERE at.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('user_id')::uuid IS NULL
        OR at.user_id = sqlc.narg('user_id')::uuid
    )
    AND (
        sqlc.narg('episode_id')::uuid IS NULL
        OR at.episode_id = sqlc.narg('episode_id')::uuid
    )
    AND (
        NOT sqlc.arg('active_only')::bool
        OR (
            at.revoked_at IS NULL
            AND (
                at.expires_at IS NULL
                OR at.expires_at > NOW()
            )
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY at.created_at DESC,
    at.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAccessTicketsForTenantAsc :many
SELECT at.id,
    at.tenant_id,
    at.public_id,
    at.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    at.user_id,
    u.public_id AS user_public_id,
    u.name AS user_name,
    u.email AS user_email,
    at.expires_at,
    at.revoked_at,
    at.note,
    at.created_by_user_id,
    at.created_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN users u ON u.id = at.user_id
WHERE at.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('user_id')::uuid IS NULL
        OR at.user_id = sqlc.narg('user_id')::uuid
    )
    AND (
        sqlc.narg('episode_id')::uuid IS NULL
        OR at.episode_id = sqlc.narg('episode_id')::uuid
    )
    AND (
        NOT sqlc.arg('active_only')::bool
        OR (
            at.revoked_at IS NULL
            AND (
                at.expires_at IS NULL
                OR at.expires_at > NOW()
            )
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY at.created_at ASC,
    at.id ASC
LIMIT sqlc.arg('limit');

-- name: RevokeAccessTicketByPublicIDForTenant :one
UPDATE access_tickets
SET revoked_at = NOW()
WHERE tenant_id = $1
    AND public_id = $2
    AND revoked_at IS NULL
RETURNING id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at;

-- name: GetNonRevokedAccessTicketForUserEpisode :one
-- Non-revoked ticket for a user+episode pair (may already be expired).
-- Used for idempotent issue under the unique partial index on non-revoked rows.
SELECT id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at
FROM access_tickets
WHERE tenant_id = $1
    AND user_id = $2
    AND episode_id = $3
    AND revoked_at IS NULL
ORDER BY created_at DESC,
    id DESC
LIMIT 1;

-- name: GetActiveAccessTicketForUserEpisode :one
SELECT id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at
FROM access_tickets
WHERE tenant_id = $1
    AND user_id = $2
    AND episode_id = $3
    AND revoked_at IS NULL
    AND (
        expires_at IS NULL
        OR expires_at > NOW()
    )
ORDER BY created_at DESC,
    id DESC
LIMIT 1;

-- name: UserHasEpisodeContentAccess :one
-- True when the user may view paid body content for the episode via purchase or active access ticket.
-- Free episodes (price = 0) are evaluated by the caller; this query only covers grants.
SELECT (
        EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                AND p.user_id = sqlc.arg('user_id')::uuid
                AND p.episode_id = sqlc.arg('episode_id')
                AND (
                    p.expires_at IS NULL
                    OR p.expires_at > NOW()
                )
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = sqlc.arg('tenant_id')
                AND at.user_id = sqlc.arg('user_id')
                AND at.episode_id = sqlc.arg('episode_id')
                AND at.revoked_at IS NULL
                AND (
                    at.expires_at IS NULL
                    OR at.expires_at > NOW()
                )
        )
    ) AS has_access;
