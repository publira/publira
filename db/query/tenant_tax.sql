-- The tenant's tax and invoice settings: the tax rate its prices include, as
-- tenant_tax_rates records it changing over time, and the withholding rate,
-- the legal name, and the registration number tenant_config holds.

-- name: GetCurrentTenantTaxRate :one
-- The change of rate in effect now, and when it started to apply. No row
-- where the tenant has never set a rate; a row with no rate_bps where its
-- latest change was to none. now() is the clock purchases_record_tax reads a
-- purchase's time by, through the purchase's default.
SELECT rate_bps,
    applies_from
FROM tenant_tax_rates
WHERE tenant_id = sqlc.arg('tenant_id')
    AND applies_from <= now()
ORDER BY applies_from DESC
LIMIT 1;

-- name: InsertTenantTaxRate :one
-- A change of rate applying from now. A second change saved in the same
-- transaction replaces the first.
INSERT INTO tenant_tax_rates (tenant_id, applies_from, rate_bps)
VALUES (
        sqlc.arg('tenant_id'),
        now(),
        sqlc.narg('rate_bps')
    )
ON CONFLICT (tenant_id, applies_from) DO UPDATE
SET rate_bps = EXCLUDED.rate_bps
RETURNING rate_bps,
    applies_from;

-- name: UpsertTenantInvoiceSettings :one
-- An upsert for the reason UpsertTenantCommentSettings gives. The three are
-- written together because the console offers them as one card with the tax
-- rate.
INSERT INTO tenant_config (tenant_id, invoice_legal_name, invoice_registration_number, withholding_rate_bps)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.narg('invoice_legal_name'),
        sqlc.narg('invoice_registration_number'),
        sqlc.narg('withholding_rate_bps')
    )
ON CONFLICT (tenant_id) DO UPDATE
SET invoice_legal_name = EXCLUDED.invoice_legal_name,
    invoice_registration_number = EXCLUDED.invoice_registration_number,
    withholding_rate_bps = EXCLUDED.withholding_rate_bps,
    updated_at = NOW()
RETURNING *;

-- name: GetTenantWithholdingRate :one
-- What a royalty statement closed now withholds from each Author. NULL, and
-- no row for a tenant with no config row, withhold nothing.
SELECT withholding_rate_bps
FROM tenant_config
WHERE tenant_id = sqlc.arg('tenant_id')
LIMIT 1;
