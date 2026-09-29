/**
 * Records created by `db/seeds/scenarios/290_tenant_members.sql`. Re-applying
 * it deletes the tenant and writes it again, which removes the account the
 * invitation created and puts the editor's role back.
 */

export const TENANT_MEMBERS_SCENARIO = "290_tenant_members";

/** Tenant whose console the members suite signs in on. */
export const TENANT_MEMBERS_TENANT = {
  adminDomain: "admin.team.localhost",
  domain: "team.localhost",
  name: "Team Tenant",
  publicId: "TmbrTNNTAAA1",
} as const;

/** The tenant's only tenant admin. Password hash is the same as `adminpass`. */
export const TENANT_MEMBERS_ADMIN = {
  email: "team-admin@example.com",
  name: "Team E2E Admin",
  password: "adminpass",
  publicId: "TmbrADMNAAA1",
} as const;

/** A tenant editor of that tenant, on the same password. */
export const TENANT_MEMBERS_EDITOR = {
  email: "team-editor@example.com",
  name: "Team E2E Editor",
  password: "adminpass",
  publicId: "TmbrEDTRAAA1",
} as const;

/** The address the suite invites. No account holds it when the run starts. */
export const TENANT_MEMBERS_INVITEE = {
  email: "team-invitee@example.com",
  name: "Team E2E Invitee",
  password: "invitee-pass-2684",
} as const;
