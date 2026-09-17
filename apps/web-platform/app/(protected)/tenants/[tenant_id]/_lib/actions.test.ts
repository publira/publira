import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddPlatformTenantMember,
  mockAssertSameOrigin,
  mockCancelPlatformTenantAdminInvitation,
  mockCreatePlatformTenantAdminInvitation,
  mockGetPlatformLocale,
  mockRemovePlatformTenantMember,
  mockResendPlatformTenantAdminInvitation,
  mockResolveAccessToken,
  mockResumePlatformTenant,
  mockSuspendPlatformTenant,
  mockUpdatePlatformTenant,
  mockUpdatePlatformTenantMemberRole,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAddPlatformTenantMember: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
  mockCancelPlatformTenantAdminInvitation: vi.fn(),
  mockCreatePlatformTenantAdminInvitation: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockRemovePlatformTenantMember: vi.fn(),
  mockResendPlatformTenantAdminInvitation: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockResumePlatformTenant: vi.fn(),
  mockSuspendPlatformTenant: vi.fn(),
  mockUpdatePlatformTenant: vi.fn(),
  mockUpdatePlatformTenantMemberRole: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: mockGetPlatformLocale };
});

vi.mock("#lib/tenants", () => ({
  addPlatformTenantMember: mockAddPlatformTenantMember,
  cancelPlatformTenantAdminInvitation: mockCancelPlatformTenantAdminInvitation,
  createPlatformTenantAdminInvitation: mockCreatePlatformTenantAdminInvitation,
  platformTenantCacheTag: (publicId: string) => `platform:tenants:${publicId}`,
  platformTenantsCacheTag: "platform:tenants",
  removePlatformTenantMember: mockRemovePlatformTenantMember,
  resendPlatformTenantAdminInvitation: mockResendPlatformTenantAdminInvitation,
  resumePlatformTenant: mockResumePlatformTenant,
  suspendPlatformTenant: mockSuspendPlatformTenant,
  updatePlatformTenant: mockUpdatePlatformTenant,
  updatePlatformTenantMemberRole: mockUpdatePlatformTenantMemberRole,
}));

vi.mock("#lib/users", () => ({ platformEndUsersCacheTag: "platform:users" }));

vi.mock("#lib/dashboard", () => ({
  platformDashboardCacheTag: "platform:dashboard",
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
};

const clearedTags = (): string[] =>
  mockUpdateTag.mock.calls.map(([tag]) => tag as string);

describe("tenant detail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withPlatformSessionReauth` resolves the session before the mutation
    // runs; without a token every Action under test would redirect to /login.
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("suspending or resuming a tenant clears the tenants, the dashboard, and the audit log", async () => {
    const { resumeTenantAction, suspendTenantAction } =
      await import("./actions");

    await suspendTenantAction(formData({ tenant_id: "TENANT00001" }));
    await resumeTenantAction(formData({ tenant_id: "TENANT00001" }));

    const expected = [
      "platform:tenants",
      "platform:dashboard",
      "platform:audit-logs",
    ];
    expect(clearedTags()).toEqual([...expected, ...expected]);
  });

  it("renaming a tenant also clears the end users, whose rows name their tenant", async () => {
    mockUpdatePlatformTenant.mockResolvedValueOnce({ ok: true });

    const { updateTenantNameAction } = await import("./actions");

    await updateTenantNameAction(
      null,
      formData({
        tenant_current_domain: "tenant.example.com",
        tenant_id: "TENANT00001",
        tenant_name: "Renamed Tenant",
      })
    );

    expect(clearedTags()).toEqual([
      "platform:tenants",
      "platform:users",
      "platform:audit-logs",
    ]);
  });

  it("changing a tenant's domain clears the tenants and the audit log", async () => {
    mockUpdatePlatformTenant.mockResolvedValueOnce({ ok: true });

    const { updateTenantDomainAction } = await import("./actions");

    await updateTenantDomainAction(
      null,
      formData({
        tenant_current_name: "Example Tenant",
        tenant_domain: "renamed.example.com",
        tenant_id: "TENANT00001",
      })
    );

    expect(clearedTags()).toEqual(["platform:tenants", "platform:audit-logs"]);
  });

  it("adding or removing a member clears that tenant, the end users, and the dashboard", async () => {
    mockAddPlatformTenantMember.mockResolvedValueOnce({ ok: true });
    mockRemovePlatformTenantMember.mockResolvedValueOnce({ ok: true });

    const { addTenantMemberAction, removeTenantMemberAction } =
      await import("./actions");

    await addTenantMemberAction(
      null,
      formData({
        member_email: "editor@example.com",
        member_role: "tenant_editor",
        tenant_id: "TENANT00001",
      })
    );
    await removeTenantMemberAction(
      null,
      formData({
        member_user_public_id: "USER00000001",
        tenant_id: "TENANT00001",
      })
    );

    const expected = [
      "platform:tenants:TENANT00001",
      "platform:users",
      "platform:dashboard",
    ];
    expect(clearedTags()).toEqual([...expected, ...expected]);
  });

  it("changing a member's role clears only that tenant", async () => {
    mockUpdatePlatformTenantMemberRole.mockResolvedValueOnce({ ok: true });

    const { updateTenantMemberRoleAction } = await import("./actions");

    await updateTenantMemberRoleAction(
      null,
      formData({
        member_role: "tenant_admin",
        member_user_public_id: "USER00000001",
        tenant_id: "TENANT00001",
      })
    );

    expect(clearedTags()).toEqual(["platform:tenants:TENANT00001"]);
  });

  it("inviting an admin also clears the end users and the dashboard, since an existing account is granted the role at once", async () => {
    mockCreatePlatformTenantAdminInvitation.mockResolvedValueOnce({
      ok: true,
      roleGrantedImmediately: true,
    });

    const { createTenantAdminInvitationAction } = await import("./actions");

    await createTenantAdminInvitationAction(
      null,
      formData({ invite_email: "admin@example.com", tenant_id: "TENANT00001" })
    );

    expect(clearedTags()).toEqual([
      "platform:tenants:TENANT00001",
      "platform:users",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });

  it("resending or canceling an invitation clears that tenant and the audit log", async () => {
    mockResendPlatformTenantAdminInvitation.mockResolvedValueOnce({ ok: true });
    mockCancelPlatformTenantAdminInvitation.mockResolvedValueOnce({ ok: true });

    const {
      cancelTenantAdminInvitationAction,
      resendTenantAdminInvitationAction,
    } = await import("./actions");

    const invitation = { invitation_id: "INVITE001", tenant_id: "TENANT00001" };
    await resendTenantAdminInvitationAction(null, formData(invitation));
    await cancelTenantAdminInvitationAction(null, formData(invitation));

    const expected = ["platform:tenants:TENANT00001", "platform:audit-logs"];
    expect(clearedTags()).toEqual([...expected, ...expected]);
  });

  it("clears nothing for a submission that fails validation", async () => {
    const { suspendTenantAction } = await import("./actions");

    await suspendTenantAction(formData({ tenant_id: "  " }));

    expect(mockSuspendPlatformTenant).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
