-- name: LockTenantWebhookEndpoints :exec
-- Serializes the writes that count a tenant's endpoints, so two creates cannot
-- each find four and each add a fifth.
SELECT pg_advisory_xact_lock(
        hashtextextended(
            'tenant-webhook-endpoints:' || sqlc.arg('tenant_id')::uuid::text,
            0
        )
    );

-- name: CountTenantWebhookEndpoints :one
SELECT count(*)::integer AS count
FROM tenant_webhook_endpoints
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: CreateTenantWebhookEndpoint :one
INSERT INTO tenant_webhook_endpoints (
        id,
        tenant_id,
        url,
        secret_encrypted,
        secret_hint,
        event_types,
        enabled
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('url'),
        sqlc.arg('secret_encrypted'),
        sqlc.arg('secret_hint'),
        sqlc.arg('event_types')::text [],
        sqlc.arg('enabled')
    )
RETURNING *;

-- name: ListTenantWebhookEndpoints :many
-- Every endpoint of the tenant's, oldest first. A tenant keeps at most five.
SELECT *
FROM tenant_webhook_endpoints
WHERE tenant_id = sqlc.arg('tenant_id')
ORDER BY created_at,
    id;

-- name: GetTenantWebhookEndpointForUpdate :one
SELECT *
FROM tenant_webhook_endpoints
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id') FOR
UPDATE;

-- name: UpdateTenantWebhookEndpoint :one
UPDATE tenant_webhook_endpoints
SET url = sqlc.arg('url'),
    event_types = sqlc.arg('event_types')::text [],
    enabled = sqlc.arg('enabled'),
    updated_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
RETURNING *;

-- name: RotateTenantWebhookEndpointSecret :one
UPDATE tenant_webhook_endpoints
SET secret_encrypted = sqlc.arg('secret_encrypted'),
    secret_hint = sqlc.arg('secret_hint'),
    updated_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
RETURNING *;

-- name: DeleteTenantWebhookEndpoint :execrows
DELETE FROM tenant_webhook_endpoints
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: ListTenantWebhookEndpointsForEvent :many
-- The endpoints an event of event_type is owed to: the enabled ones that
-- subscribed to it.
SELECT id
FROM tenant_webhook_endpoints
WHERE tenant_id = sqlc.arg('tenant_id')
    AND enabled
    AND sqlc.arg('event_type')::text = ANY (event_types)
ORDER BY created_at,
    id;

-- name: InsertWebhookDelivery :one
-- Owes one endpoint one event. An event already owed to the endpoint — the
-- same change recorded twice — inserts nothing and returns no row.
INSERT INTO webhook_deliveries (
        id,
        tenant_id,
        endpoint_id,
        event_type,
        event_id,
        payload
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('endpoint_id'),
        sqlc.arg('event_type'),
        sqlc.arg('event_id'),
        sqlc.arg('payload')
    ) ON CONFLICT (endpoint_id, event_id) DO NOTHING
RETURNING id;

-- name: GetWebhookDeliveryToSend :one
-- A delivery with the endpoint it goes to, as the worker sends it.
SELECT d.id,
    d.tenant_id,
    d.endpoint_id,
    d.event_type,
    d.event_id,
    d.payload,
    d.status,
    d.attempts,
    e.url,
    e.secret_encrypted,
    e.enabled
FROM webhook_deliveries d
    JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id
    AND e.id = d.endpoint_id
WHERE d.tenant_id = sqlc.arg('tenant_id')
    AND d.id = sqlc.arg('id');

-- name: RecordWebhookDeliveryAttempt :exec
-- Records one attempt at a delivery and what it came to.
UPDATE webhook_deliveries
SET status = sqlc.arg('status'),
    attempts = attempts + 1,
    last_status_code = sqlc.narg('last_status_code'),
    last_error = sqlc.narg('last_error'),
    delivered_at = CASE
        WHEN sqlc.arg('status')::text = 'delivered' THEN now()
        ELSE NULL
    END,
    updated_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: GiveUpWebhookDelivery :exec
-- Gives up a delivery no attempt was made at, its endpoint disabled since it
-- was queued.
UPDATE webhook_deliveries
SET status = 'dead',
    last_error = sqlc.arg('last_error'),
    updated_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND status <> 'delivered';

-- name: GetWebhookDeliveryForUpdate :one
SELECT *
FROM webhook_deliveries
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id') FOR
UPDATE;

-- name: ResendWebhookDelivery :exec
-- Owes a dead delivery again, keeping the attempts made so far.
UPDATE webhook_deliveries
SET status = 'pending',
    updated_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: ListWebhookDeliveriesDesc :many
-- The tenant's deliveries, newest first, narrowed to one status when one is
-- named.
SELECT d.id,
    d.endpoint_id,
    e.url AS endpoint_url,
    d.event_type,
    d.event_id,
    d.status,
    d.attempts,
    d.last_status_code,
    d.last_error,
    d.delivered_at,
    d.created_at,
    d.updated_at
FROM webhook_deliveries d
    JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id
    AND e.id = d.endpoint_id
WHERE d.tenant_id = sqlc.arg('tenant_id')::uuid
    AND (
        sqlc.narg('status')::text IS NULL
        OR d.status = sqlc.narg('status')::text
    )
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (d.created_at, d.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (d.created_at, d.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY d.created_at DESC,
    d.id DESC
LIMIT sqlc.arg('limit');

-- name: ListWebhookDeliveriesAsc :many
-- ListWebhookDeliveriesDesc read towards the newer rows, for a previous page.
SELECT d.id,
    d.endpoint_id,
    e.url AS endpoint_url,
    d.event_type,
    d.event_id,
    d.status,
    d.attempts,
    d.last_status_code,
    d.last_error,
    d.delivered_at,
    d.created_at,
    d.updated_at
FROM webhook_deliveries d
    JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id
    AND e.id = d.endpoint_id
WHERE d.tenant_id = sqlc.arg('tenant_id')::uuid
    AND (
        sqlc.narg('status')::text IS NULL
        OR d.status = sqlc.narg('status')::text
    )
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (d.created_at, d.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (d.created_at, d.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY d.created_at ASC,
    d.id ASC
LIMIT sqlc.arg('limit');

-- name: GetWebhookPurchase :one
-- A purchase as a webhook event carries it: the ids the admin API answers it
-- by, and the reader's address.
SELECT p.id,
    p.kind,
    p.price_at_purchase,
    purchase_royalty_basis(p.list_price, p.price_at_purchase)::integer AS list_price,
    p.currency,
    p.purchased_at,
    p.expires_at,
    COALESCE(p.refunded_amount, 0)::integer AS refunded_amount,
    p.refunded_at,
    p.provider,
    p.store,
    p.is_test,
    (p.coin_pack_id IS NOT NULL)::boolean AS coin_pack,
    (p.series_bundle_id IS NOT NULL)::boolean AS series_bundle,
    u.public_id AS reader_public_id,
    u.email AS reader_email,
    e.public_id AS episode_public_id,
    v.public_id AS volume_public_id,
    COALESCE(es.public_id, vs.public_id, bs.public_id, '')::text AS series_public_id
FROM purchases p
    LEFT JOIN users u ON u.tenant_id = p.tenant_id
    AND u.id = p.user_id
    LEFT JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    LEFT JOIN series es ON es.tenant_id = e.tenant_id
    AND es.id = e.series_id
    LEFT JOIN volumes v ON v.tenant_id = p.tenant_id
    AND v.id = p.volume_id
    LEFT JOIN series vs ON vs.tenant_id = v.tenant_id
    AND vs.id = v.series_id
    LEFT JOIN series_bundles b ON b.tenant_id = p.tenant_id
    AND b.id = p.series_bundle_id
    LEFT JOIN series bs ON bs.tenant_id = b.tenant_id
    AND bs.id = b.series_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.id = sqlc.arg('id');

-- name: GetWebhookReader :one
SELECT u.public_id,
    u.email,
    u.name,
    u.email_verified_at,
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.id = sqlc.arg('id');

-- name: GetWebhookSubscription :one
SELECT s.id,
    s.provider,
    s.status,
    s.current_period_end,
    s.cancel_at_period_end,
    s.is_test,
    s.created_at,
    sp.public_id AS plan_public_id,
    sp.name AS plan_name,
    u.public_id AS reader_public_id,
    u.email AS reader_email
FROM subscriptions s
    JOIN subscription_plans sp ON sp.tenant_id = s.tenant_id
    AND sp.id = s.plan_id
    LEFT JOIN users u ON u.tenant_id = s.tenant_id
    AND u.id = s.user_id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('id');

-- name: GetWebhookDelivery :one
-- One delivery, shaped as ListWebhookDeliveriesDesc answers it.
SELECT d.id,
    d.endpoint_id,
    e.url AS endpoint_url,
    d.event_type,
    d.event_id,
    d.status,
    d.attempts,
    d.last_status_code,
    d.last_error,
    d.delivered_at,
    d.created_at,
    d.updated_at
FROM webhook_deliveries d
    JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id
    AND e.id = d.endpoint_id
WHERE d.tenant_id = sqlc.arg('tenant_id')
    AND d.id = sqlc.arg('id');
