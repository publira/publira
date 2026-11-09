/**
 * Records created by `db/seeds/scenarios/810_tenant_deletion.sql`.
 * Re-applying it deletes the tenant, if it is still there, and writes it again,
 * suspended.
 */

export const TENANT_DELETION_SCENARIO = "810_tenant_deletion";

/** The suspended tenant the suite deletes. */
export const DELETION_TENANT = {
  id: "018f1840-0001-7000-8000-000000000001",
  name: "Deletion Tenant",
  publicId: "DeltTNNTAAA1",
} as const;

/** The Operator who opens the tenant's page and is not offered the deletion. */
export const DELETION_OPERATOR = {
  email: "deletion-operator@example.com",
  password: "platformpass",
} as const;

/** The Auditor who opens the tenant's page and is not offered the deletion. */
export const DELETION_AUDITOR = {
  email: "deletion-auditor@example.com",
  password: "platformpass",
} as const;
