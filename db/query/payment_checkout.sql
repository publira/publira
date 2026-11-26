-- name: RecordPaymentCheckout :exec
-- A retried request names the same checkout with the same purchase, so the
-- row already there is kept, and only when it was last started moves.
INSERT INTO payment_checkouts (
    tenant_id,
    provider,
    checkout_id,
    purchase,
    request
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('provider'),
    sqlc.arg('checkout_id'),
    sqlc.arg('purchase'),
    sqlc.narg('request')
)
ON CONFLICT (tenant_id, provider, checkout_id) DO UPDATE
SET last_started_at = now();

-- name: GetPaymentCheckoutPurchase :one
SELECT purchase
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id');

-- name: ListPaymentCheckouts :many
-- The checkouts first started before started_to and last started at or after
-- started_from, which are every checkout started in between, however many
-- times a request started it, each with the payment kept as its completion.
SELECT checkout_id, payment_id
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND last_started_at >= sqlc.arg('started_from')
    AND created_at < sqlc.arg('started_to')
ORDER BY created_at, checkout_id;

-- name: IsPaymentCheckoutLapsed :one
-- Whether lifetime_seconds have passed since the checkout was first started,
-- the earliest the provider could have made it, after which the provider may
-- answer its id with a checkout that can no longer be paid.
SELECT (created_at <= now() - make_interval(secs => sqlc.arg('lifetime_seconds')::double precision))::boolean AS lapsed
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id');

-- name: IsPaymentCheckoutClosed :one
-- Whether lifetime_seconds have passed since the checkout was last started,
-- after which the provider takes no payment of it.
SELECT payment_checkout_closed(last_started_at, sqlc.arg('lifetime_seconds')::double precision)::boolean AS closed
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id');

-- name: GetBrowserPaymentCheckout :one
-- The checkout a storefront page runs a provider's script for, with whether
-- lifetime_seconds have passed since it was last started, after which the
-- page starts no payment of it.
SELECT
    purchase,
    request,
    payment_id,
    payment_checkout_closed(last_started_at, sqlc.arg('lifetime_seconds')::double precision)::boolean AS closed
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id');

-- name: LockPaymentCheckout :one
-- Holds the checkout while a payment completes it, so that the page and the
-- provider's notification completing it at once capture the payment once,
-- with whether lifetime_seconds have passed since it was last started, after
-- which no payment of it is captured.
SELECT
    purchase,
    payment_id,
    payment_checkout_closed(last_started_at, sqlc.arg('lifetime_seconds')::double precision)::boolean AS closed
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id')
FOR UPDATE;

-- name: KeepPaymentCheckoutPayment :exec
-- Keeps the payment that completed the checkout. A checkout is completed by
-- one payment, so a payment already kept is never replaced.
UPDATE payment_checkouts
SET payment_id = sqlc.arg('payment_id')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id')
    AND payment_id IS NULL;

-- name: GetReaderPaymentHistory :one
-- What the reader has paid the tenant in currency, as a provider that judges
-- a buyer by their history with the merchant is told it: how many payments,
-- their total less what was refunded of them, and the latest of them. Test
-- payments took no money, so they are left out, and so are the payments made
-- through the provider being told, which holds those itself and asks for the
-- rest. A reader who has paid nothing has no latest payment, and its columns
-- then hold the time they registered and zero.
SELECT
    u.public_id,
    u.created_at AS registered_at,
    totals.payments,
    totals.amount_paid,
    coalesce(latest.purchased_at, u.created_at)::timestamptz AS last_paid_at,
    coalesce(latest.price_at_purchase, 0)::bigint AS last_amount
FROM users AS u
CROSS JOIN LATERAL (
    SELECT
        count(*)::bigint AS payments,
        coalesce(sum(p.price_at_purchase - coalesce(p.refunded_amount, 0)), 0)::bigint AS amount_paid
    FROM purchases AS p
    WHERE p.tenant_id = u.tenant_id
        AND p.user_id = u.id
        AND p.currency = sqlc.arg('currency')
        AND NOT p.is_test
        AND p.provider IS DISTINCT FROM sqlc.arg('provider')::text
) AS totals
LEFT JOIN LATERAL (
    SELECT p.purchased_at, p.price_at_purchase
    FROM purchases AS p
    WHERE p.tenant_id = u.tenant_id
        AND p.user_id = u.id
        AND p.currency = sqlc.arg('currency')
        AND NOT p.is_test
        AND p.provider IS DISTINCT FROM sqlc.arg('provider')::text
    ORDER BY p.purchased_at DESC, p.id DESC
    LIMIT 1
) AS latest ON true
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.id = sqlc.arg('user_id');

-- name: PaymentCheckoutStarted :one
-- Whether the tenant started the checkout through the provider, which a
-- notification naming it is held to before a provider that signs none is
-- asked about its payment.
SELECT EXISTS (
    SELECT 1
    FROM payment_checkouts
    WHERE tenant_id = sqlc.arg('tenant_id')
        AND provider = sqlc.arg('provider')
        AND checkout_id = sqlc.arg('checkout_id')
)::boolean AS started;

-- name: ProviderPaymentMayBeTenants :one
-- Whether the payment may be one of the tenant's through the provider: one a
-- purchase recorded, one a checkout kept as its completion, or, while a
-- checkout of the tenant's can still be paid and keeps no payment, any
-- payment, since nothing ties a payment to such a checkout before the
-- provider is asked. A notification naming the payment is held to this before
-- a provider that signs none is asked about it.
--
-- The three are read in one statement, and so from one snapshot: a
-- completion committing the payment beside its checkout between two reads
-- would leave the payment neither awaited by the one before it nor kept by
-- the one after.
SELECT (
    EXISTS (
        SELECT 1
        FROM purchases AS p
        WHERE p.tenant_id = sqlc.arg('tenant_id')
            AND p.provider = sqlc.arg('provider')::text
            AND p.provider_payment_id = sqlc.arg('payment_id')::text
    )
    OR EXISTS (
        SELECT 1
        FROM payment_checkouts AS c
        WHERE c.tenant_id = sqlc.arg('tenant_id')
            AND c.provider = sqlc.arg('provider')::text
            AND c.payment_id = sqlc.arg('payment_id')::text
    )
    OR EXISTS (
        SELECT 1
        FROM payment_checkouts AS c
        WHERE c.tenant_id = sqlc.arg('tenant_id')
            AND c.provider = sqlc.arg('provider')::text
            AND c.payment_id IS NULL
            AND NOT payment_checkout_closed(c.last_started_at, sqlc.arg('lifetime_seconds')::double precision)
    )
)::boolean AS known;
