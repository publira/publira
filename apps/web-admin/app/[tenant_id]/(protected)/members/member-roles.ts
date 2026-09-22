/** The console roles a member can be given, in the order the select lists them. */
export const TENANT_MEMBER_ROLES = [
  "tenant_admin",
  "tenant_editor",
  "tenant_auditor",
] as const;

export type TenantMemberRole = (typeof TENANT_MEMBER_ROLES)[number];
