/**
 * Records created by `db/seeds/scenarios/400_tenant_roles.sql`: one console
 * account of each tenant role below tenant_admin, in the development seed
 * tenant. Re-applying it puts each account back on its one role.
 */

export const TENANT_ROLES_SCENARIO = "400_tenant_roles";

/** A tenant editor. Password hash is the same as `adminpass`. */
export const TENANT_ROLES_EDITOR = {
  email: "roles-editor@example.com",
  name: "Roles E2E Editor",
  password: "adminpass",
  publicId: "RoleEDTRAAA1",
} as const;

/** A tenant auditor, on the same password. */
export const TENANT_ROLES_AUDITOR = {
  email: "roles-auditor@example.com",
  name: "Roles E2E Auditor",
  password: "adminpass",
  publicId: "RoleADTRAAA1",
} as const;
