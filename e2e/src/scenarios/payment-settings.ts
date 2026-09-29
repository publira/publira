/**
 * Records created by `db/seeds/scenarios/330_payment_settings.sql`. Re-applying
 * it deletes the tenant's stored payment settings, which leaves it with no
 * provider.
 */

export const PAYMENT_SETTINGS_SCENARIO = "330_payment_settings";

/** Tenant whose console the payment settings suite signs in on. */
export const PAYMENT_SETTINGS_TENANT = {
  adminDomain: "admin.payment.localhost",
  domain: "payment.localhost",
  name: "Payment Settings Tenant",
  publicId: "PaymTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const PAYMENT_SETTINGS_ADMIN = {
  email: "payment-admin@example.com",
  name: "Payment Settings E2E Admin",
  password: "adminpass",
  publicId: "PaymADMNAAA1",
} as const;
