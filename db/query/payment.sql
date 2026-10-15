-- name: GetTenantPaymentConfigByTenantID :one
SELECT *
FROM tenant_payment_config
WHERE tenant_id = $1
LIMIT 1;

-- name: GetEnabledTenantPaymentConfigByTenantID :one
SELECT *
FROM tenant_payment_config
WHERE tenant_id = $1
    AND enabled = TRUE
LIMIT 1;

-- name: UpsertTenantPaymentConfig :one
INSERT INTO tenant_payment_config (
        tenant_id,
        provider,
        enabled,
        credentials_encrypted,
        credential_hints,
        currency,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET provider = EXCLUDED.provider,
    enabled = EXCLUDED.enabled,
    credentials_encrypted = EXCLUDED.credentials_encrypted,
    credential_hints = EXCLUDED.credential_hints,
    currency = EXCLUDED.currency,
    updated_at = NOW()
RETURNING *;

-- name: LockTenantCurrency :exec
-- Serializes, for the rest of the caller's transaction, a change of the
-- currency a tenant sells in against every write of a price checked against
-- it, which takes LockTenantCurrencyShared. The check and the write then see
-- the same currency, so a change cannot commit between them and leave a price
-- typed in one currency stored as an amount of another.
SELECT pg_advisory_xact_lock(hashtextextended('tenant-currency:' || sqlc.arg('tenant_id')::uuid::text, 0));

-- name: LockTenantCurrencyShared :exec
-- Holds off, for the rest of the caller's transaction, a change of the
-- tenant's currency (LockTenantCurrency), while letting other price writes of
-- the same tenant go on.
SELECT pg_advisory_xact_lock_shared(hashtextextended('tenant-currency:' || sqlc.arg('tenant_id')::uuid::text, 0));

-- name: TenantHasPurchases :one
-- Whether the tenant has any purchase, from a provider's checkout or a store,
-- test ones included, which keeps the tenant currency from changing.
SELECT EXISTS (
        SELECT 1
        FROM purchases
        WHERE tenant_id = $1
    );

-- name: GetPurchasableEpisodeForTenant :one
SELECT e.id,
    e.public_id,
    et.title,
    s.public_id AS series_public_id,
    el.price,
    el.reading_period_hours,
    el.rental_price,
    el.rental_period_hours,
    -- Where the episode may be bought, which the caller holds against the
    -- surface the checkout is started from.
    epa.purchase_availability
FROM episodes e
    CROSS JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
    JOIN episode_purchase_availability epa ON epa.episode_id = e.id
WHERE e.id = sqlc.arg('id')
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    -- An episode the calling surface may not show is no row, as it is in the
    -- catalog: a surface cannot sell what it cannot show.
    AND EXISTS (
        SELECT 1
        FROM published_episode_surfaces pes
        WHERE pes.episode_id = e.id
            AND pes.surface = sqlc.arg('surface')::text
    )
LIMIT 1;

-- name: GetActiveEpisodePurchaseKinds :one
-- Which of the episode's two sales the reader holds an active purchase of.
-- Only a purchase counts: an access ticket does not stop the reader buying.
SELECT EXISTS (
        SELECT 1
        FROM episode_content_grants g
        WHERE g.tenant_id = sqlc.arg('tenant_id')
            -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
            AND g.user_id = sqlc.arg('user_id')::uuid
            AND g.episode_id = sqlc.arg('episode_id')
            AND g.purchase_kind = 'purchase'
    ) AS holds_purchase,
    EXISTS (
        SELECT 1
        FROM episode_content_grants g
        WHERE g.tenant_id = sqlc.arg('tenant_id')
            AND g.user_id = sqlc.arg('user_id')::uuid
            AND g.episode_id = sqlc.arg('episode_id')
            AND g.purchase_kind = 'rental'
    ) AS holds_rental;

-- name: ListMyPurchasesDesc :many
-- The reader's library, newest purchase first. Publication is not re-checked,
-- so a purchase outlives the episode being taken down, but the calling surface
-- is: an episode that surface may not show is left out of the library read
-- there, as it is left out of the catalog.
SELECT p.id,
    p.kind,
    p.price_at_purchase,
    p.currency,
    p.expires_at,
    p.revoked_at,
    p.refunded_amount,
    p.refunded_at,
    p.purchased_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    e.order_index AS episode_order_index,
    s.id AS series_id,
    s.public_id AS series_public_id,
    str.title AS series_title
FROM purchases p
    JOIN episodes e ON e.id = p.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et
    JOIN series s ON s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) str
WHERE p.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is in nobody's library.
    AND p.user_id = sqlc.arg('user_id')::uuid
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM episode_surfaces es
        WHERE es.episode_id = e.id
            AND es.surface = sqlc.arg('surface')::text
    )
    AND (
        sqlc.narg('cursor_purchased_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) <= (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) < (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY p.purchased_at DESC,
    p.id DESC
LIMIT sqlc.arg('limit');

-- name: ListMyPurchasesAsc :many
SELECT p.id,
    p.kind,
    p.price_at_purchase,
    p.currency,
    p.expires_at,
    p.revoked_at,
    p.refunded_amount,
    p.refunded_at,
    p.purchased_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    e.order_index AS episode_order_index,
    s.id AS series_id,
    s.public_id AS series_public_id,
    str.title AS series_title
FROM purchases p
    JOIN episodes e ON e.id = p.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et
    JOIN series s ON s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) str
WHERE p.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is in nobody's library.
    AND p.user_id = sqlc.arg('user_id')::uuid
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM episode_surfaces es
        WHERE es.episode_id = e.id
            AND es.surface = sqlc.arg('surface')::text
    )
    AND (
        sqlc.narg('cursor_purchased_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) >= (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) > (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY p.purchased_at ASC,
    p.id ASC
LIMIT sqlc.arg('limit');

-- name: CreatePurchaseFromProviderCheckout :one
-- Every checkout the provider reports paid is a purchase of its own, even for a
-- reader who already holds one for the episode: the payment was taken, so it is
-- a sale to report and to match a refund against. A redelivery of the same
-- checkout is no row.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    expires_at,
    provider,
    provider_checkout_id,
    provider_payment_id,
    is_test,
    currency,
    kind
)
VALUES (
    sqlc.arg('id')::uuid,
    sqlc.arg('tenant_id')::uuid,
    sqlc.arg('user_id')::uuid,
    sqlc.arg('episode_id')::uuid,
    sqlc.arg('price_at_purchase')::integer,
    sqlc.narg('expires_at')::timestamptz,
    sqlc.arg('provider')::text,
    sqlc.arg('provider_checkout_id')::text,
    sqlc.narg('provider_payment_id')::text,
    sqlc.arg('is_test')::boolean,
    sqlc.arg('currency')::text,
    sqlc.arg('kind')::text
)
ON CONFLICT (provider, provider_checkout_id) DO NOTHING
RETURNING *;

-- name: GetPurchaseReceiptForTenant :one
-- What the receipt of one purchase says, read by the outbox worker, which
-- connects past RLS and therefore names the tenant itself. The reader is
-- joined within the tenant, so an account that was deleted after paying, whose
-- purchase keeps no user, answers no address rather than no receipt.
SELECT
    p.id,
    p.price_at_purchase,
    p.currency,
    p.purchased_at,
    p.expires_at,
    p.is_test,
    et.title AS episode_title,
    str.title AS series_title,
    u.email AS reader_email
FROM purchases p
JOIN episodes e
    ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
CROSS JOIN LATERAL episode_translation_for(e.id, '') et
JOIN series s
    ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') str
LEFT JOIN users u
    ON u.tenant_id = p.tenant_id
    AND u.id = p.user_id
WHERE p.tenant_id = sqlc.arg('tenant_id')::uuid
    AND p.id = sqlc.arg('id')::uuid;

-- name: RecordRefundOnPurchase :one
-- Records what the provider has refunded against one purchase, matched by the
-- payment the refund notification names. Nothing matches when the payment
-- belongs to another tenant, another provider, or no purchase here, and the
-- caller reads that empty result as a delivery it has no sale for.
--
-- The amount the provider reports is cumulative over every refund against the
-- payment, so GREATEST keeps an out-of-order delivery from walking it back, and
-- an event that reports no amount at all, or one in a currency other than the
-- purchase's, which says nothing comparable to its price, is recorded as a
-- refund of the whole price. refunded_at follows from the amount rather than from the event:
-- it is set once the refunded total reaches what was paid, and a repeated
-- delivery of the same refund leaves the instant already stored. The same
-- moment revokes the purchase, unless something revoked it first, whose reason
-- it keeps.
WITH refund AS (
    SELECT p.id,
        GREATEST(
            COALESCE(p.refunded_amount, 0),
            COALESCE(
                CASE
                    WHEN sqlc.narg('currency')::text = p.currency THEN sqlc.narg('refunded_amount')::integer
                END,
                p.price_at_purchase
            )
        ) AS amount
    FROM purchases p
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND p.provider = sqlc.arg('provider')::text
        AND p.provider_payment_id = sqlc.arg('provider_payment_id')::text
)
UPDATE purchases p
SET refunded_amount = refund.amount,
    refunded_at = CASE
        WHEN refund.amount >= p.price_at_purchase THEN COALESCE(p.refunded_at, NOW())
        ELSE p.refunded_at
    END,
    revoked_at = CASE
        WHEN refund.amount >= p.price_at_purchase THEN COALESCE(p.revoked_at, NOW())
        ELSE p.revoked_at
    END,
    revocation_reason = CASE
        WHEN refund.amount >= p.price_at_purchase THEN COALESCE(p.revocation_reason, 'refund')
        ELSE p.revocation_reason
    END
FROM refund
WHERE p.id = refund.id
RETURNING p.*;

-- name: LiftStaffRevocation :one
-- Takes back the revocation RevokePurchaseForStaff made when the refund it was
-- made for did not happen, and moves the purchase on to staff's next attempt
-- when next_attempt is set: the provider refused or failed the refund, and
-- under the same idempotency key would only answer that again. A purchase a
-- refund has covered in full since, one whose dispute has been lost since, or
-- one that something else revoked, is left alone.
UPDATE purchases
SET revoked_at = NULL,
    revocation_reason = NULL,
    staff_refund_attempt = staff_refund_attempt + CASE WHEN sqlc.arg('next_attempt')::boolean THEN 1 ELSE 0 END
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND revocation_reason = 'staff'
    AND refunded_at IS NULL
    AND dispute_lost_at IS NULL
RETURNING id;

-- name: RecordFailedRefundOnPurchase :one
-- Records that a refund of the purchase's payment failed after the provider
-- accepted it, taking the total that stays refunded from the provider as it
-- now stands, which is the one place a recorded amount goes down. Once that
-- total falls short of the price, the purchase is no longer refunded in full,
-- and a revocation that came from a refund, the provider's or the one staff
-- asked for, is lifted with it, so the reader keeps what they still pay for,
-- and lifting staff's moves the purchase on to staff's next attempt, which a
-- new request is sent under: the provider would answer the failed one again.
-- A total of nothing is still recorded as an amount rather than as no refund:
-- royalty_uncarried_refunds reads a purchase with an amount, which is how a
-- refund a closed statement already carried is carried back. A dispute keeps
-- its revocation, and so does a purchase whose dispute was lost, whatever
-- revoked it. Nothing matches a payment of another tenant,
-- another provider, no purchase here, or a total in a currency other than the
-- purchase's, which says nothing comparable to its price.
UPDATE purchases p
SET refunded_amount = sqlc.arg('refunded_amount')::integer,
    refunded_at = CASE
        WHEN sqlc.arg('refunded_amount')::integer >= p.price_at_purchase THEN p.refunded_at
    END,
    revoked_at = CASE
        WHEN sqlc.arg('refunded_amount')::integer < p.price_at_purchase
            AND p.revocation_reason IN ('refund', 'staff')
            AND p.dispute_lost_at IS NULL THEN NULL
        ELSE p.revoked_at
    END,
    revocation_reason = CASE
        WHEN sqlc.arg('refunded_amount')::integer < p.price_at_purchase
            AND p.revocation_reason IN ('refund', 'staff')
            AND p.dispute_lost_at IS NULL THEN NULL
        ELSE p.revocation_reason
    END,
    staff_refund_attempt = p.staff_refund_attempt + CASE
        WHEN sqlc.arg('refunded_amount')::integer < p.price_at_purchase
            AND p.revocation_reason = 'staff'
            AND p.dispute_lost_at IS NULL THEN 1
        ELSE 0
    END
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.provider = sqlc.arg('provider')::text
    AND p.provider_payment_id = sqlc.arg('provider_payment_id')::text
    AND p.currency = sqlc.arg('currency')::text
RETURNING p.*;

-- name: HoldUnappliedRefund :exec
-- Keeps a refund whose purchase is not here yet, so the notification that
-- creates the purchase can still apply it. The provider's payment is the
-- identity, so a repeated delivery updates the row rather than adding one.
--
-- A NULL amount means the event reported none, which is applied as a refund of
-- the whole price; it therefore outranks any number on a later merge, as two
-- amounts in different currencies do, since neither can be added to the
-- other, and between two numbers in one currency the larger wins, because the
-- provider reports the total refunded so far.
INSERT INTO unapplied_refunds (
    tenant_id,
    provider,
    provider_payment_id,
    refunded_amount,
    currency
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('provider')::text,
    sqlc.arg('provider_payment_id')::text,
    sqlc.narg('refunded_amount')::integer,
    sqlc.narg('currency')::text
)
ON CONFLICT (tenant_id, provider, provider_payment_id) DO
UPDATE
SET refunded_amount = CASE
        WHEN unapplied_refunds.refunded_amount IS NULL
            OR EXCLUDED.refunded_amount IS NULL
            OR unapplied_refunds.currency <> EXCLUDED.currency THEN NULL
        ELSE GREATEST(unapplied_refunds.refunded_amount, EXCLUDED.refunded_amount)
    END,
    currency = CASE
        WHEN unapplied_refunds.refunded_amount IS NULL
            OR EXCLUDED.refunded_amount IS NULL
            OR unapplied_refunds.currency <> EXCLUDED.currency THEN NULL
        ELSE EXCLUDED.currency
    END,
    received_at = NOW();

-- name: ApplyUnappliedRefundToPurchase :one
-- Writes a held refund onto the purchase that has since been created, by the
-- same rules RecordRefundOnPurchase uses. Nothing matches when no refund is
-- held for the payment, which is the ordinary case.
--
-- The held row is left for the caller to delete once this has committed. A
-- crash in between costs a repeat of an update that is idempotent, whereas
-- deleting here would lose the refund if the update never landed.
WITH held AS (
    SELECT r.tenant_id,
        r.provider,
        r.provider_payment_id,
        r.refunded_amount,
        r.currency
    FROM unapplied_refunds r
    WHERE r.tenant_id = sqlc.arg('tenant_id')
        AND r.provider = sqlc.arg('provider')::text
        AND r.provider_payment_id = sqlc.arg('provider_payment_id')::text
),
refund AS (
    SELECT p.id,
        GREATEST(
            COALESCE(p.refunded_amount, 0),
            COALESCE(
                CASE
                    WHEN held.currency = p.currency THEN held.refunded_amount
                END,
                p.price_at_purchase
            )
        ) AS amount
    FROM purchases p
        JOIN held ON held.tenant_id = p.tenant_id
            AND held.provider = p.provider
            AND held.provider_payment_id = p.provider_payment_id
)
UPDATE purchases p
SET refunded_amount = refund.amount,
    refunded_at = CASE
        WHEN refund.amount >= p.price_at_purchase THEN COALESCE(p.refunded_at, NOW())
        ELSE p.refunded_at
    END,
    revoked_at = CASE
        WHEN refund.amount >= p.price_at_purchase THEN COALESCE(p.revoked_at, NOW())
        ELSE p.revoked_at
    END,
    revocation_reason = CASE
        WHEN refund.amount >= p.price_at_purchase THEN COALESCE(p.revocation_reason, 'refund')
        ELSE p.revocation_reason
    END
FROM refund
WHERE p.id = refund.id
RETURNING p.*;

-- name: ReplaceUnappliedRefund :exec
-- Sets a held refund to the total that stays refunded once one of the refunds
-- it counted has failed, the one place a held amount goes down. Nothing is
-- held for the payment in the ordinary case, and nothing changes then.
UPDATE unapplied_refunds
SET refunded_amount = sqlc.arg('refunded_amount')::integer,
    currency = sqlc.arg('currency')::text,
    received_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')::text
    AND provider_payment_id = sqlc.arg('provider_payment_id')::text;

-- name: ReleaseUnappliedRefund :exec
DELETE FROM unapplied_refunds
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')::text
    AND provider_payment_id = sqlc.arg('provider_payment_id')::text;

-- name: RecordDisputeOnPurchase :one
-- Revokes the purchase of the payment a dispute names. A disputed charge opens
-- nothing while the reader's bank holds the money, whatever the dispute later
-- decides, and a repeated delivery leaves the instant and the reason already
-- stored. Nothing matches when the payment belongs to another tenant, another
-- provider, or no purchase here.
UPDATE purchases
SET revoked_at = COALESCE(revoked_at, NOW()),
    revocation_reason = COALESCE(revocation_reason, 'dispute')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')::text
    AND provider_payment_id = sqlc.arg('provider_payment_id')::text
RETURNING *;

-- name: RecordLostDisputeOnPurchase :one
-- Records that the dispute of the payment was lost: the reader's bank has
-- returned the money to them for good, so royalty statements no longer count
-- the purchase as a sale. The purchase is revoked as a dispute too, unless
-- something revoked it first, since the notification that opened the dispute
-- need not have arrived. A repeated delivery leaves the instants and the
-- reason already stored. Nothing matches when the payment belongs to another
-- tenant, another provider, or no purchase here.
UPDATE purchases
SET dispute_lost_at = COALESCE(dispute_lost_at, NOW()),
    revoked_at = COALESCE(revoked_at, NOW()),
    revocation_reason = COALESCE(revocation_reason, 'dispute')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')::text
    AND provider_payment_id = sqlc.arg('provider_payment_id')::text
RETURNING *;

-- name: HoldUnappliedDispute :exec
-- Keeps a dispute whose purchase is not here yet, so the notification that
-- creates the purchase can still revoke it, and record it lost when lost is
-- set. A dispute held as lost stays lost through a later delivery of the one
-- that opened it.
INSERT INTO unapplied_disputes (
    tenant_id,
    provider,
    provider_payment_id,
    lost_at
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('provider')::text,
    sqlc.arg('provider_payment_id')::text,
    CASE WHEN sqlc.arg('lost')::boolean THEN NOW() END
)
ON CONFLICT (tenant_id, provider, provider_payment_id) DO
UPDATE
SET lost_at = COALESCE(unapplied_disputes.lost_at, EXCLUDED.lost_at),
    received_at = NOW();

-- name: ApplyUnappliedDisputeToPurchase :one
-- Revokes the purchase that has since been created for a held dispute, and
-- records the dispute lost if it was held as lost, by the same rules
-- RecordDisputeOnPurchase and RecordLostDisputeOnPurchase use. Nothing matches
-- when no dispute is held for the payment, which is the ordinary case. The
-- held row is deleted by the caller in the same transaction.
UPDATE purchases p
SET revoked_at = COALESCE(p.revoked_at, NOW()),
    revocation_reason = COALESCE(p.revocation_reason, 'dispute'),
    dispute_lost_at = COALESCE(p.dispute_lost_at, d.lost_at)
FROM unapplied_disputes d
WHERE d.tenant_id = p.tenant_id
    AND d.provider = p.provider
    AND d.provider_payment_id = p.provider_payment_id
    AND p.tenant_id = sqlc.arg('tenant_id')
    AND p.provider = sqlc.arg('provider')::text
    AND p.provider_payment_id = sqlc.arg('provider_payment_id')::text
RETURNING p.*;

-- name: ReleaseUnappliedDispute :exec
DELETE FROM unapplied_disputes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')::text
    AND provider_payment_id = sqlc.arg('provider_payment_id')::text;

-- name: RecordExpiredCheckout :exec
-- Records the checkout the provider reports expired as the reader's latest on
-- the episode. A repeated delivery names the same checkout and changes
-- nothing the idempotency key reads. A reader or an episode deleted since the
-- checkout started records nothing, since there is no next checkout to key.
INSERT INTO expired_checkouts (
    tenant_id,
    user_id,
    episode_id,
    provider,
    provider_checkout_id
)
SELECT u.tenant_id,
    u.id,
    e.id,
    sqlc.arg('provider')::text,
    sqlc.arg('provider_checkout_id')::text
FROM users u
    JOIN episodes e ON e.tenant_id = u.tenant_id
WHERE u.tenant_id = sqlc.arg('tenant_id')::uuid
    AND u.id = sqlc.arg('user_id')
    AND e.id = sqlc.arg('episode_id')
ON CONFLICT (tenant_id, user_id, episode_id) DO
UPDATE
SET provider = EXCLUDED.provider,
    provider_checkout_id = EXCLUDED.provider_checkout_id,
    expired_at = NOW();

-- name: GetExpiredCheckoutID :one
-- The checkout the reader last let expire on the episode, which the next
-- checkout's idempotency key names. No row is a reader who has let none expire.
SELECT provider_checkout_id
FROM expired_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND episode_id = sqlc.arg('episode_id');

-- The console's purchase list is (purchased_at, id) DESC. A forward page reads
-- ListPurchaseIDsForTenantDesc and a backward one ListPurchaseIDsForTenantAsc,
-- both over idx_purchases_tenant_purchased_at_id, and the handler puts the
-- ascending rows back into display order. id is a UUIDv7, so the order stays
-- unique when purchased_at ties. These read the keys alone, and
-- ListPurchasesForTenantByIDs reads what the page shows. Cursor rules:
-- proto/README.md.
-- name: ListPurchaseIDsForTenantDesc :many
SELECT p.id,
    p.purchased_at
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('series_id')::uuid IS NULL
        OR EXISTS (
            SELECT 1
            FROM episodes e
            WHERE e.tenant_id = p.tenant_id
                AND e.id = p.episode_id
                AND e.series_id = sqlc.narg('series_id')::uuid
        )
    )
    AND (
        sqlc.narg('episode_id')::uuid IS NULL
        OR p.episode_id = sqlc.narg('episode_id')::uuid
    )
    AND (
        sqlc.narg('reader_email')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM users u
            WHERE u.tenant_id = p.tenant_id
                AND u.id = p.user_id
                AND lower(u.email) = lower(sqlc.narg('reader_email')::text)
        )
    )
    AND (
        sqlc.narg('purchased_from')::timestamptz IS NULL
        OR p.purchased_at >= sqlc.narg('purchased_from')::timestamptz
    )
    AND (
        sqlc.narg('purchased_to')::timestamptz IS NULL
        OR p.purchased_at < sqlc.narg('purchased_to')::timestamptz
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) <= (sqlc.narg('cursor_purchased_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) < (sqlc.narg('cursor_purchased_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY p.purchased_at DESC,
    p.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPurchaseIDsForTenantAsc :many
SELECT p.id,
    p.purchased_at
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('series_id')::uuid IS NULL
        OR EXISTS (
            SELECT 1
            FROM episodes e
            WHERE e.tenant_id = p.tenant_id
                AND e.id = p.episode_id
                AND e.series_id = sqlc.narg('series_id')::uuid
        )
    )
    AND (
        sqlc.narg('episode_id')::uuid IS NULL
        OR p.episode_id = sqlc.narg('episode_id')::uuid
    )
    AND (
        sqlc.narg('reader_email')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM users u
            WHERE u.tenant_id = p.tenant_id
                AND u.id = p.user_id
                AND lower(u.email) = lower(sqlc.narg('reader_email')::text)
        )
    )
    AND (
        sqlc.narg('purchased_from')::timestamptz IS NULL
        OR p.purchased_at >= sqlc.narg('purchased_from')::timestamptz
    )
    AND (
        sqlc.narg('purchased_to')::timestamptz IS NULL
        OR p.purchased_at < sqlc.narg('purchased_to')::timestamptz
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) >= (sqlc.narg('cursor_purchased_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) > (sqlc.narg('cursor_purchased_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY p.purchased_at ASC,
    p.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPurchasesForTenantByIDs :many
-- What the console shows of each purchase named, in no particular order. The
-- buyer is joined within the tenant, so the purchase of a reader who has since
-- deleted their account, which keeps no user, answers no buyer rather than no
-- row.
SELECT p.id,
    p.episode_id,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title,
    u.public_id AS reader_public_id,
    u.name AS reader_name,
    u.email AS reader_email,
    p.price_at_purchase,
    p.currency,
    p.purchased_at,
    p.expires_at,
    p.provider,
    p.provider_payment_id,
    p.store,
    p.is_test,
    p.refunded_amount,
    p.refunded_at,
    p.revoked_at,
    p.revocation_reason,
    p.staff_refund_attempt
FROM purchases p
    JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, '') str
    LEFT JOIN users u ON u.tenant_id = p.tenant_id
    AND u.id = p.user_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.id = ANY(sqlc.arg('ids')::uuid[]);

-- name: RevokePurchaseForStaff :one
-- Revokes a purchase staff are about to refund, before the provider is asked,
-- so that whatever the provider reports about the refund lands on a purchase
-- already revoked. It answers no row when there is nothing for this call to
-- change: staff revoked it already, which a second request racing the first
-- finds once that one commits, or the reader's dispute revoked it first, which
-- the dispute keeps. A refund recorded first gives way to staff while its
-- instant stays.
UPDATE purchases
SET revoked_at = COALESCE(revoked_at, NOW()),
    revocation_reason = 'staff'
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND revocation_reason IS DISTINCT FROM 'staff'
    AND revocation_reason IS DISTINCT FROM 'dispute'
RETURNING id;
