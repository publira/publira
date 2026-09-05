-- Outbox queries. Producers insert a pending row in the
-- same transaction as the domain write. The worker claims due rows,
-- runs the handler, and records done / retry / dead.
--
-- Auth-mail payloads carry the raw token the token tables store only
-- as a hash. Terminal updates drop that key so a processed row does
-- not keep a usable secret.
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

-- Auth mail is the one place the raw token still has to appear: the
-- token tables store a hash, so the producing transaction writes the
-- secret into payload for the worker to render. Once the event is
-- terminal the worker no longer needs it, so the key is dropped and
-- the rest of the payload stays for diagnosis. The plaintext window
-- is the pending/processing lifetime. Retries keep the token so a
-- later attempt can still send the mail. While the worker is running
-- that window is the retry budget (ten attempts, delays doubling
-- from 1s and capped at 1h).
-- name: MarkOutboxEventDone :one
UPDATE outbox_events
SET
    status = 'done',
    last_error = NULL,
    payload = payload - 'token',
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

-- Same token drop as MarkOutboxEventDone: a dead auth event is as
-- terminal as a successful one, and the secret is no longer needed
-- to send the mail.
-- name: MarkOutboxEventDead :one
UPDATE outbox_events
SET
    status = 'dead',
    attempts = attempts + 1,
    last_error = sqlc.narg('last_error'),
    payload = payload - 'token',
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Release a claim when River already has an in-flight process job for
-- this event (unique skip). attempts and available_at stay as they were.
-- name: UnclaimOutboxEvent :one
UPDATE outbox_events
SET
    status = 'pending',
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Re-queue rows left in processing after a worker crash. updated_at is the
-- claim time; callers pass now minus the stale-processing grace period.
-- name: RecoverStaleProcessingOutboxEvents :many
UPDATE outbox_events
SET
    status = 'pending',
    available_at = NOW(),
    updated_at = NOW()
WHERE status = 'processing'
    AND updated_at <= sqlc.arg('stale_before')
RETURNING *;
