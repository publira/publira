-- name: ListTenantPaymentProviders :many
-- Every provider the tenant holds, retired ones included, in the order it
-- added them.
SELECT *
FROM tenant_payment_providers
WHERE tenant_id = $1
ORDER BY created_at,
    id;

-- name: GetTenantPaymentProvider :one
SELECT *
FROM tenant_payment_providers
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
LIMIT 1;

-- name: UpsertTenantPaymentProvider :one
-- Saves one provider of the tenant's. Saving a retired one is adding it back,
-- so it sells again.
INSERT INTO tenant_payment_providers (
        tenant_id,
        provider,
        enabled,
        credentials_encrypted,
        credential_hints,
        updated_at
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('provider'),
        sqlc.arg('enabled'),
        sqlc.arg('credentials_encrypted'),
        sqlc.arg('credential_hints'),
        NOW()
    ) ON CONFLICT (tenant_id, provider) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    credentials_encrypted = EXCLUDED.credentials_encrypted,
    credential_hints = EXCLUDED.credential_hints,
    retired_at = NULL,
    updated_at = NOW()
RETURNING *;

-- name: RetireTenantPaymentProvider :one
-- Keeps a removed provider for what it already took, and stops it selling. A
-- provider retired already keeps the instant it was retired at.
UPDATE tenant_payment_providers
SET retired_at = COALESCE(retired_at, NOW()),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
RETURNING *;

-- name: DeleteTenantPaymentProvider :execrows
DELETE FROM tenant_payment_providers
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider');

-- name: TenantPaymentProviderHasOpenPayments :one
-- Whether the provider still has something of the tenant's to act on: a
-- payment of a purchase that is neither refunded in full nor lost to a
-- dispute, which a refund may still reach, or a subscription it goes on
-- billing.
SELECT (
        EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                AND p.provider = sqlc.arg('provider')::text
                AND p.provider_payment_id IS NOT NULL
                AND p.refunded_at IS NULL
                AND p.dispute_lost_at IS NULL
        )
        OR EXISTS (
            SELECT 1
            FROM subscriptions s
            WHERE s.tenant_id = sqlc.arg('tenant_id')
                AND s.provider = sqlc.arg('provider')::text
                AND s.status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused')
        )
    )::boolean AS open;
