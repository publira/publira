-- name: DeleteFinishedPaymentReconciliation :exec
-- The finished run of a period and source, which a run started again
-- replaces. An unfinished one is left for the worker, and the run started
-- again answers it instead.
DELETE FROM payment_reconciliations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND COALESCE(provider, store) = COALESCE(sqlc.narg('provider')::text, sqlc.narg('store')::text)
    AND start_date = sqlc.arg('start_date')
    AND end_date = sqlc.arg('end_date')
    AND finished_at IS NOT NULL;

-- name: CreatePaymentReconciliation :one
-- No row when the period and source already have a run the worker has not
-- finished.
INSERT INTO payment_reconciliations (
        id,
        tenant_id,
        provider,
        store,
        start_date,
        end_date,
        time_zone,
        starts_at,
        ends_at
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.narg('provider'),
        sqlc.narg('store'),
        sqlc.arg('start_date'),
        sqlc.arg('end_date'),
        sqlc.arg('time_zone'),
        sqlc.arg('starts_at'),
        sqlc.arg('ends_at')
    ) ON CONFLICT (tenant_id, (COALESCE(provider, store)), start_date, end_date) DO NOTHING
RETURNING *;

-- name: GetPaymentReconciliationForPeriod :one
SELECT *
FROM payment_reconciliations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND COALESCE(provider, store) = COALESCE(sqlc.narg('provider')::text, sqlc.narg('store')::text)
    AND start_date = sqlc.arg('start_date')
    AND end_date = sqlc.arg('end_date');

-- name: GetPaymentReconciliation :one
SELECT *
FROM payment_reconciliations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- Admin ListPaymentReconciliations is (started_at, id) DESC. Forward uses the
-- DESC query; backward uses ASC so idx_payment_reconciliations_tenant_started_at
-- can be scanned in reverse. The handler flips ASC rows back into display
-- order. cursor rules: proto/README.md.
-- name: ListPaymentReconciliationsDesc :many
SELECT *
FROM payment_reconciliations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (started_at, id) <= (sqlc.narg('cursor_started_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (started_at, id) < (sqlc.narg('cursor_started_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY started_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: ListPaymentReconciliationsAsc :many
SELECT *
FROM payment_reconciliations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (started_at, id) >= (sqlc.narg('cursor_started_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (started_at, id) > (sqlc.narg('cursor_started_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY started_at ASC, id ASC
LIMIT sqlc.arg('limit');

-- Admin ListPaymentReconciliationFindings is (occurred_at, id) ASC, the order
-- the lines happened in. Forward uses the ASC query; backward uses DESC, and
-- the handler flips its rows back. A NULL kind or is_test is no filter.
-- name: ListPaymentReconciliationFindingsAsc :many
SELECT *
FROM payment_reconciliation_findings
WHERE tenant_id = sqlc.arg('tenant_id')
    AND reconciliation_id = sqlc.arg('reconciliation_id')
    AND (sqlc.narg('kind')::text IS NULL OR kind = sqlc.narg('kind')::text)
    AND (sqlc.narg('is_test')::boolean IS NULL OR is_test = sqlc.narg('is_test')::boolean)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (occurred_at, id) >= (sqlc.narg('cursor_occurred_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (occurred_at, id) > (sqlc.narg('cursor_occurred_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY occurred_at ASC, id ASC
LIMIT sqlc.arg('limit');

-- name: ListPaymentReconciliationFindingsDesc :many
SELECT *
FROM payment_reconciliation_findings
WHERE tenant_id = sqlc.arg('tenant_id')
    AND reconciliation_id = sqlc.arg('reconciliation_id')
    AND (sqlc.narg('kind')::text IS NULL OR kind = sqlc.narg('kind')::text)
    AND (sqlc.narg('is_test')::boolean IS NULL OR is_test = sqlc.narg('is_test')::boolean)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (occurred_at, id) <= (sqlc.narg('cursor_occurred_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (occurred_at, id) < (sqlc.narg('cursor_occurred_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: ClaimPaymentReconciliation :one
-- The oldest run no worker has finished, and none holds a claim on younger
-- than stale_before, with the claim taken. SKIP LOCKED keeps two workers that
-- ask at once from taking the same run.
UPDATE payment_reconciliations
SET claimed_at = sqlc.arg('claimed_at')
WHERE id = (
        SELECT pr.id
        FROM payment_reconciliations pr
        WHERE pr.finished_at IS NULL
            AND (
                pr.claimed_at IS NULL
                OR pr.claimed_at < sqlc.arg('stale_before')
            )
        ORDER BY pr.started_at, pr.id
        LIMIT 1 FOR UPDATE SKIP LOCKED
    )
RETURNING *;

-- name: FinishPaymentReconciliation :execrows
-- Records the counts of a run whose claim is still the one that ran it, so a
-- run another worker has taken over since writes nothing.
UPDATE payment_reconciliations
SET finished_at = now(),
    record_count = sqlc.arg('record_count'),
    purchase_count = sqlc.arg('purchase_count'),
    matched_count = sqlc.arg('matched_count'),
    finding_count = sqlc.arg('finding_count')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND claimed_at = sqlc.arg('claimed_at')
    AND finished_at IS NULL;

-- name: FailPaymentReconciliation :execrows
UPDATE payment_reconciliations
SET finished_at = now(),
    failure = sqlc.arg('failure')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND claimed_at = sqlc.arg('claimed_at')
    AND finished_at IS NULL;

-- name: CreatePaymentReconciliationFinding :exec
INSERT INTO payment_reconciliation_findings (
        id,
        tenant_id,
        reconciliation_id,
        kind,
        is_test,
        purchase_id,
        provider_payment_id,
        purchase_amount,
        purchase_refunded_amount,
        purchase_currency,
        record_amount,
        record_refunded_amount,
        record_currency,
        occurred_at
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('reconciliation_id'),
        sqlc.arg('kind'),
        sqlc.arg('is_test'),
        sqlc.narg('purchase_id'),
        sqlc.narg('provider_payment_id'),
        sqlc.narg('purchase_amount'),
        sqlc.narg('purchase_refunded_amount'),
        sqlc.narg('purchase_currency'),
        sqlc.narg('record_amount'),
        sqlc.narg('record_refunded_amount'),
        sqlc.narg('record_currency'),
        sqlc.arg('occurred_at')
    );

-- name: ListReconciledPurchasesInPeriod :many
-- The purchases a source charged for in a range of instants, by the provider
-- or the store they name. A purchase paid with coins names the provider
-- `coins`, which no source is.
SELECT id,
    provider_payment_id,
    store_transaction_id,
    price_at_purchase,
    COALESCE(refunded_amount, 0)::bigint AS refunded_amount,
    currency,
    is_test,
    purchased_at,
    coin_pack_id
FROM purchases
WHERE tenant_id = sqlc.arg('tenant_id')
    AND purchased_at >= sqlc.arg('purchased_from')
    AND purchased_at < sqlc.arg('purchased_to')
    AND (
        provider = sqlc.narg('provider')::text
        OR store = sqlc.narg('store')::text
    )
ORDER BY purchased_at,
    id;

-- name: ListReconciledPurchasesByPaymentIDs :many
-- The purchases a provider's payments name, wherever they fall, so that a
-- payment the provider took in the period and the install confirmed after it
-- still matches its purchase.
SELECT id,
    provider_payment_id,
    store_transaction_id,
    price_at_purchase,
    COALESCE(refunded_amount, 0)::bigint AS refunded_amount,
    currency,
    is_test,
    purchased_at,
    coin_pack_id
FROM purchases
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND provider_payment_id = ANY (sqlc.arg('payment_ids')::text[]);

-- name: ListReconciledPurchasesByStoreTransactionIDs :many
-- ListReconciledPurchasesByPaymentIDs for a store's transactions.
SELECT id,
    provider_payment_id,
    store_transaction_id,
    price_at_purchase,
    COALESCE(refunded_amount, 0)::bigint AS refunded_amount,
    currency,
    is_test,
    purchased_at,
    coin_pack_id
FROM purchases
WHERE tenant_id = sqlc.arg('tenant_id')
    AND store = sqlc.arg('store')
    AND store_transaction_id = ANY (sqlc.arg('transaction_ids')::text[]);

-- name: ListReconciledSubscriptionPaymentIntents :many
-- The payment intents among payment_ids that paid a plan's invoice rather
-- than a purchase, which a reconciliation of purchases leaves out.
SELECT stripe_payment_intent_id::text AS payment_intent_id
FROM subscription_payments
WHERE tenant_id = sqlc.arg('tenant_id')
    AND stripe_payment_intent_id = ANY (sqlc.arg('payment_ids')::text[]);

-- name: ListHeldRefundsReceivedBefore :many
SELECT provider_payment_id,
    refunded_amount,
    currency,
    received_at
FROM unapplied_refunds
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND received_at < sqlc.arg('received_before')
ORDER BY received_at,
    provider_payment_id;

-- name: ListHeldDisputesReceivedBefore :many
SELECT provider_payment_id,
    received_at
FROM unapplied_disputes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND received_at < sqlc.arg('received_before')
ORDER BY received_at,
    provider_payment_id;

-- name: ListHeldStoreRefundsReceivedBefore :many
SELECT store_transaction_id,
    received_at
FROM unapplied_store_refunds
WHERE tenant_id = sqlc.arg('tenant_id')
    AND store = sqlc.arg('store')
    AND received_at < sqlc.arg('received_before')
ORDER BY received_at,
    store_transaction_id;

-- name: ListPurchasesForExport :many
-- What ExportPurchases writes for a range of instants: every purchase charged
-- through a provider or a store in it, and every refund of one dated in it.
-- A refund in full is dated by refunded_at; a refund in part has no date of
-- its own, so it is listed with the period its purchase was made in. A
-- purchase paid with coins, or granted without a payment, charged nothing.
SELECT p.id,
    p.purchased_at,
    p.refunded_at,
    p.price_at_purchase,
    COALESCE(p.refunded_amount, 0)::bigint AS refunded_amount,
    p.currency,
    p.kind,
    p.episode_id,
    p.volume_id,
    p.series_bundle_id,
    p.coin_pack_id,
    p.provider,
    p.provider_checkout_id,
    p.provider_payment_id,
    p.store,
    p.store_transaction_id,
    p.is_test,
    (
        p.purchased_at >= sqlc.arg('starts_at')
        AND p.purchased_at < sqlc.arg('ends_at')
    )::boolean AS purchased_in_period,
    (
        COALESCE(p.refunded_amount, 0) > 0
        AND (
            (
                p.refunded_at >= sqlc.arg('starts_at')
                AND p.refunded_at < sqlc.arg('ends_at')
            )
            OR (
                p.refunded_at IS NULL
                AND p.purchased_at >= sqlc.arg('starts_at')
                AND p.purchased_at < sqlc.arg('ends_at')
            )
        )
    )::boolean AS refunded_in_period
FROM purchases p
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND (
        p.store IS NOT NULL
        OR (
            p.provider IS NOT NULL
            AND p.provider <> 'coins'
        )
    )
    AND (
        (
            p.purchased_at >= sqlc.arg('starts_at')
            AND p.purchased_at < sqlc.arg('ends_at')
        )
        OR (
            p.refunded_at >= sqlc.arg('starts_at')
            AND p.refunded_at < sqlc.arg('ends_at')
        )
    )
ORDER BY p.purchased_at,
    p.id;
