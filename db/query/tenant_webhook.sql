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
-- Owes one endpoint one event and queues the webhook_delivery outbox event
-- that sends it, in one statement, so neither is written without the other
-- even on a connection outside a transaction. An event already owed to the
-- endpoint — the same change recorded twice — writes nothing and returns no
-- row.
WITH delivery AS (
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
    RETURNING id,
        tenant_id
)
INSERT INTO outbox_events (
        id,
        tenant_id,
        event_type,
        payload,
        idempotency_key,
        available_at
    )
SELECT sqlc.arg('outbox_event_id'),
    delivery.tenant_id,
    'webhook_delivery',
    jsonb_build_object(
        'tenant_id',
        delivery.tenant_id::text,
        'delivery_id',
        delivery.id::text
    ),
    'webhook_delivery:' || delivery.id::text,
    now()
FROM delivery ON CONFLICT (idempotency_key) DO NOTHING
RETURNING (payload->>'delivery_id')::uuid AS delivery_id;

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

-- name: GetWebhookCoinPackPurchase :one
-- A purchase of a coin pack as the coin_pack.purchased event of its recording
-- carries it, read in the transaction that records it: the purchase's id, the
-- pack's public id, the coins and bonus coins coin_pack_purchases recorded it
-- granting, what the reader paid, and the reader's public id, empty once they
-- have deleted their account.
SELECT p.id,
    p.price_at_purchase,
    p.currency,
    p.purchased_at,
    p.provider,
    p.store,
    p.is_test,
    cp.public_id AS coin_pack_public_id,
    cpp.coins,
    cpp.bonus_coins,
    u.public_id AS reader_public_id
FROM purchases p
    JOIN coin_pack_purchases cpp ON cpp.tenant_id = p.tenant_id
    AND cpp.purchase_id = p.id
    JOIN tenant_coin_packs cp ON cp.tenant_id = p.tenant_id
    AND cp.id = p.coin_pack_id
    LEFT JOIN users u ON u.tenant_id = p.tenant_id
    AND u.id = p.user_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.id = sqlc.arg('id');

-- name: GetWebhookTip :one
-- A tip as the tip.received event of its recording carries it, read in the
-- transaction that records it: the purchase's id, the episode and its series
-- by their public ids, what the reader paid, the reader's public id, empty
-- once they have deleted their account, and the public ids of the Authors
-- episode_creators credits the episode to as the tip is recorded. They come in
-- the order the episode's credits are shown, role priority first, then
-- display_order, then the name, and an Author credited in more than one role is
-- named once, where their first credit stands.
SELECT p.id,
    p.price_at_purchase,
    p.currency,
    p.purchased_at,
    p.provider,
    p.store,
    p.is_test,
    e.public_id AS episode_public_id,
    s.public_id AS series_public_id,
    u.public_id AS reader_public_id,
    ARRAY(
        SELECT credit.public_id
        FROM (
                SELECT c.id,
                    c.public_id,
                    row_number() OVER (
                        ORDER BY cr.display_priority ASC NULLS LAST,
                            ec.display_order ASC,
                            c.name ASC,
                            c.id ASC
                    ) AS position
                FROM episode_creators ec
                    JOIN creators c ON c.tenant_id = ec.tenant_id
                    AND c.id = ec.creator_id
                    LEFT JOIN creator_roles cr ON cr.tenant_id = ec.tenant_id
                    AND cr.id = ec.role_id
                WHERE ec.tenant_id = p.tenant_id
                    AND ec.episode_id = p.episode_id
            ) credit
        GROUP BY credit.id,
            credit.public_id
        ORDER BY min(credit.position)
    )::text [] AS creator_public_ids
FROM purchases p
    JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN users u ON u.tenant_id = p.tenant_id
    AND u.id = p.user_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.id = sqlc.arg('id')
    AND p.kind = 'tip';

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

-- name: GetWebhookEpisode :one
-- An episode as an episode.published event carries it, read in the
-- transaction that publishes it: the ids the admin API answers the episode and
-- its series by, its title in the tenant's default language, and the instant
-- the publication recorded. An episode that is not published answers no row.
SELECT e.public_id AS episode_public_id,
    s.public_id AS series_public_id,
    et.title,
    el.published_at::timestamptz AS published_at
FROM episodes e
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    JOIN episode_listings el ON el.tenant_id = e.tenant_id
    AND el.episode_id = e.id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id')
    AND el.status = 'published'
    AND el.published_at IS NOT NULL;

-- name: GetWebhookUnpublishedEpisode :one
-- An episode as an episode.unpublished event carries it when the episode itself
-- is taken off the site, read in the transaction that takes it off: the ids the
-- admin API answers the episode and its series by.
SELECT e.public_id AS episode_public_id,
    s.public_id AS series_public_id
FROM episodes e
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id');

-- name: ListWebhookPublishedEpisodesOfSeries :many
-- The episodes an episode.unpublished event is owed for when their series is
-- hidden, read in the transaction that hides it: every episode of the series
-- that is published, with the ids the admin API answers it and the series by.
SELECT e.id AS episode_id,
    e.public_id AS episode_public_id,
    s.public_id AS series_public_id
FROM episodes e
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    JOIN episode_listings el ON el.tenant_id = e.tenant_id
    AND el.episode_id = e.id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.series_id = sqlc.arg('series_id')
    AND el.status = 'published'
ORDER BY e.order_index,
    e.id;

-- name: LockWebhookPublishedEpisodesOfSeries :many
-- The episodes an episode.published event is owed for when their series is
-- made public, read in the transaction that makes it public: every episode of
-- the series that is published, with the ids the admin API answers it and the
-- series by, its title in the tenant's default language, and the instant its
-- publication recorded.
--
-- The listings are locked, because a save that takes an episode off the site
-- updates its listing and owes its episode.unpublished in the same
-- transaction. The two take turns: a withdrawal that commits first leaves the
-- episode out, since a locking read that waited checks again that the listing
-- it waited on is published, and one that comes second waits until these
-- events have committed ahead of its own.
SELECT e.id AS episode_id,
    e.public_id AS episode_public_id,
    s.public_id AS series_public_id,
    et.title,
    el.published_at
FROM episodes e
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    JOIN episode_listings el ON el.tenant_id = e.tenant_id
    AND el.episode_id = e.id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.series_id = sqlc.arg('series_id')
    AND el.status = 'published'
ORDER BY e.order_index,
    e.id
FOR SHARE OF el;

-- name: GetWebhookComment :one
-- A comment as a comment.posted event carries it, read in the transaction that
-- makes it visible: its public id and those of its episode and series, the
-- body, the instant it became visible, and its writer's public id and display
-- name, never their address. A comment that is not published answers no row.
SELECT c.public_id AS comment_public_id,
    e.public_id AS episode_public_id,
    s.public_id AS series_public_id,
    c.body,
    c.published_at::timestamptz AS published_at,
    u.public_id AS author_public_id,
    u.name AS author_name
FROM episode_comments c
    JOIN episodes e ON e.tenant_id = c.tenant_id
    AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    JOIN users u ON u.tenant_id = c.tenant_id
    AND u.id = c.user_id
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = sqlc.arg('id')
    AND c.status = 'published'
    AND c.published_at IS NOT NULL;

-- name: GetWebhookContactMessage :one
-- A contact message as the contact_message.received event of its arrival
-- carries it, read in the transaction that stores it: its public id, subject,
-- and body, when it arrived, and the public id and display name of the account
-- that sent it, empty for a reader who was not signed in. Never the address
-- the reader asked to be answered at.
SELECT m.public_id AS message_public_id,
    m.subject,
    m.body,
    m.created_at,
    u.public_id AS reader_public_id,
    u.name AS reader_name
FROM contact_messages m
    LEFT JOIN users u ON u.tenant_id = m.tenant_id
    AND u.id = m.user_id
WHERE m.tenant_id = sqlc.arg('tenant_id')
    AND m.id = sqlc.arg('id');

-- name: GetWebhookContactMessageReply :one
-- A reader's reply as the contact_message.received event of its arrival
-- carries it, read in the transaction that stores it: what
-- GetWebhookContactMessage answers for the message it replies to, with the
-- reply's body and arrival in place of the message's. A staff entry answers no
-- row.
SELECT m.public_id AS message_public_id,
    m.subject,
    me.body,
    me.created_at,
    u.public_id AS reader_public_id,
    u.name AS reader_name
FROM contact_message_entries me
    JOIN contact_messages m ON m.tenant_id = me.tenant_id
    AND m.id = me.contact_message_id
    LEFT JOIN users u ON u.tenant_id = m.tenant_id
    AND u.id = m.user_id
WHERE me.tenant_id = sqlc.arg('tenant_id')
    AND me.id = sqlc.arg('id')
    AND me.direction = 'reader';

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
