/**
 * Records created by `db/seeds/scenarios/780_tax_settings.sql`. Re-applying
 * it deletes the tenant and writes it again, which takes the settings the
 * suite saves and the month it closes.
 */

export const TAX_SETTINGS_SCENARIO = "780_tax_settings";

export const TAX_SETTINGS_TENANT = {
  id: "018f1760-0001-7000-8000-000000000001",
  publicId: "TaxsTNNTAAA1",
} as const;

/** Tenant admin, who saves the settings. Password hash is that of `adminpass`. */
export const TAX_SETTINGS_ADMIN = {
  email: "tax-admin@example.com",
  name: "Tax E2E Admin",
  password: "adminpass",
  publicId: "TaxsADMNAAA1",
} as const;

/** Tenant editor, who reads the settings. Password hash is that of `adminpass`. */
export const TAX_SETTINGS_EDITOR = {
  email: "tax-editor@example.com",
  name: "Tax E2E Editor",
  password: "adminpass",
  publicId: "TaxsEDTRAAA1",
} as const;

/**
 * January 2026: two sales of a 1,100-yen episode before the tenant's 10% rate
 * applied on the 16th, and two after it, each including 100 yen of tax. The
 * Author's 50% is a line of each rate, paying 1,100 yen each, the second of
 * them including 100 yen of tax.
 */
export const TAX_SETTINGS_SALES = {
  artist: "Tax Artist",
  episode: "Tax Episode 001-01",
  period: "2026-01",
  periodLabel: "January 2026",
  rateAppliesFrom: "Jan 16, 2026, 12:00 AM",
  /** The two purchases after the rate, newest first in the list. */
  taxedPurchaseIds: [
    "018f1760-0008-7000-8000-000000000004",
    "018f1760-0008-7000-8000-000000000003",
  ],
  untaxedPurchaseId: "018f1760-0008-7000-8000-000000000001",
} as const;
