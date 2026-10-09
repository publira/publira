/**
 * Records created by `db/seeds/scenarios/480_tenant_suspension.sql`.
 * Re-applying it deletes the tenant and writes it again, active.
 */

export const TENANT_SUSPENSION_SCENARIO = "480_tenant_suspension";

/** The tenant the suite suspends and resumes. */
export const SUSPENSION_TENANT = {
  id: "018f10a0-0001-7000-8000-000000000001",
  name: "Suspension Tenant",
  publicId: "PausTNNTAAA1",
} as const;

/** The tenant's only tenant admin, whose session the suite holds through it. */
export const SUSPENSION_ADMIN = {
  publicId: "PausADMNAAA1",
  role: "tenant_admin",
} as const;
