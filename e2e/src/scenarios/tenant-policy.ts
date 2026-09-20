/**
 * Records created by the tenant policy E2E scenario. Re-applying it deletes the
 * two override rows, which puts every value back to the platform default.
 */

export const TENANT_POLICY_SCENARIO = "240_tenant_policy";

/** Tenant whose console the policy suite signs in on. */
export const TENANT_POLICY_TENANT = {
  adminDomain: "admin.policy.localhost",
  domain: "policy.localhost",
  name: "Policy Tenant",
  publicId: "PlcyTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const TENANT_POLICY_ADMIN = {
  email: "policy-admin@example.com",
  name: "Policy Settings E2E Admin",
  password: "adminpass",
  publicId: "PlcyADMNAAA1",
} as const;
