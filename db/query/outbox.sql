-- Outbox query skeleton (#610). Worker and business-event emitters land in
-- later issues; these queries pin insert, claim, and status transitions.
--
-- Expected plans (empty table may still seq-scan; SET enable_seqscan = off
-- in the integration test to confirm the index is eligible):
--   ClaimPendingOutboxEvents
--     -> idx_outbox_events_pending_available_at
--   GetOutboxEventByIdempotencyKey
--     -> outbox_events_idempotency_key_key

-- Worker insert. Same idempotency_key is a no-op so retries of the
-- producing transaction do not create a second row. :one returns no
-- rows on conflict.
-- name: InsertOutboxEvent :one
INSERT INTO outbox_events (
    id,
    tenant_id,
    event_type,
    payload,
    idempotency_key,
    available_at
)
VALUES (
    sqlc.arg('id'),
    sqlc.narg('tenant_id'),
    sqlc.arg('event_type'),
    sqlc.arg('payload'),
    sqlc.arg('idempotency_key'),
    sqlc.arg('available_at')
)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;

-- name: GetOutboxEvent :one
SELECT *
FROM outbox_events
WHERE id = sqlc.arg('id');

-- name: GetOutboxEventByIdempotencyKey :one
SELECT *
FROM outbox_events
WHERE idempotency_key = sqlc.arg('idempotency_key');

-- Claim the next due pending rows. SKIP LOCKED lets concurrent workers
-- drain without waiting on each other's locks. The CTE is required:
-- FOR UPDATE is not allowed in an IN subquery.
-- name: ClaimPendingOutboxEvents :many
WITH claim AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'pending'
        AND available_at <= NOW()
    ORDER BY available_at ASC, id ASC
    LIMIT sqlc.arg('limit')
    FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events AS o
SET
    status = 'processing',
    updated_at = NOW()
FROM claim
WHERE o.id = claim.id
RETURNING o.*;

-- name: MarkOutboxEventDone :one
UPDATE outbox_events
SET
    status = 'done',
    last_error = NULL,
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- name: MarkOutboxEventRetry :one
UPDATE outbox_events
SET
    status = 'pending',
    attempts = attempts + 1,
    available_at = sqlc.arg('available_at'),
    last_error = sqlc.narg('last_error'),
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- name: MarkOutboxEventDead :one
UPDATE outbox_events
SET
    status = 'dead',
    attempts = attempts + 1,
    last_error = sqlc.narg('last_error'),
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;
