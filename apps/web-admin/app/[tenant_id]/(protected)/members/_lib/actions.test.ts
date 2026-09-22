import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateInvitation,
  mockGetAccessToken,
  mockRemoveMember,
  mockUpdateRole,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockRemoveMember: vi.fn(),
  mockUpdateRole: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/tenant-members", () => ({
  cancelTenantAdminInvitation: vi.fn(),
  createTenantAdminInvitation: mockCreateInvitation,
  removeTenantMember: mockRemoveMember,
  resendTenantAdminInvitation: vi.fn(),
  tenantAdminInvitationsCacheTag: (tenantId: string) =>
    `tenant-admin-invitations-${tenantId}`,
  tenantMembersCacheTag: (tenantId: string) => `tenant-members-${tenantId}`,
  updateTenantMemberRole: mockUpdateRole,
}));

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("createTenantAdminInvitationAction", () => {
  it("announces the mail when an invitation was sent", async () => {
    mockCreateInvitation.mockResolvedValueOnce({
      ok: true,
      roleGrantedImmediately: false,
    });
    const { createTenantAdminInvitationAction } = await import("./actions");

    const result = await createTenantAdminInvitationAction(
      null,
      formData({ email: " new-admin@example.com " })
    );

    expect(result).toEqual({
      message: "An invitation was sent to new-admin@example.com.",
      ok: true,
    });
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      { email: "new-admin@example.com", tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant-admin-invitations-TENANT001"
    );
  });

  // Nobody is mailed when the address already belongs to a user of the
  // tenant, so announcing a mail would send the admin to wait for one.
  it("says the role was granted when the address already had an account", async () => {
    mockCreateInvitation.mockResolvedValueOnce({
      ok: true,
      roleGrantedImmediately: true,
    });
    const { createTenantAdminInvitationAction } = await import("./actions");

    const result = await createTenantAdminInvitationAction(
      null,
      formData({ email: "editor@example.com" })
    );

    expect(result).toEqual({
      message:
        "editor@example.com already has an account in this tenant and is now a tenant admin. No invitation email was sent.",
      ok: true,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant-members-TENANT001");
  });

  it("refuses an address that is not one", async () => {
    const { createTenantAdminInvitationAction } = await import("./actions");

    const result = await createTenantAdminInvitationAction(
      null,
      formData({ email: "not-an-address" })
    );

    expect(result).toEqual({
      message: "Check the email address format.",
      ok: false,
    });
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });
});

describe("updateTenantMemberRoleAction", () => {
  it("refuses a role the console does not hand out", async () => {
    const { updateTenantMemberRoleAction } = await import("./actions");

    const result = await updateTenantMemberRoleAction(
      null,
      formData({ role: "tenant_owner", user_public_id: "USER001" })
    );

    expect(result).toEqual({ message: "Choose a role.", ok: false });
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("passes the API's refusal through unchanged", async () => {
    const refusal =
      "This member is the tenant's last tenant admin. Make someone else a tenant admin before changing this role.";
    mockUpdateRole.mockResolvedValueOnce({ message: refusal, ok: false });
    const { updateTenantMemberRoleAction } = await import("./actions");

    const result = await updateTenantMemberRoleAction(
      null,
      formData({ role: "tenant_editor", user_public_id: "USER001" })
    );

    expect(result).toEqual({ message: refusal, ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("saves the role and drops the member list", async () => {
    mockUpdateRole.mockResolvedValueOnce({ member: {}, ok: true });
    const { updateTenantMemberRoleAction } = await import("./actions");

    const result = await updateTenantMemberRoleAction(
      null,
      formData({ role: "tenant_auditor", user_public_id: "USER001" })
    );

    expect(result).toEqual({ message: "Role updated.", ok: true });
    expect(mockUpdateRole).toHaveBeenCalledWith(
      {
        role: "tenant_auditor",
        tenantId: "TENANT001",
        userPublicId: "USER001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant-members-TENANT001");
  });
});

describe("removeTenantMemberAction", () => {
  it("removes the member and drops the member list", async () => {
    mockRemoveMember.mockResolvedValueOnce({
      ok: true,
      userPublicId: "USER001",
    });
    const { removeTenantMemberAction } = await import("./actions");

    const result = await removeTenantMemberAction(
      null,
      formData({ user_public_id: "USER001" })
    );

    expect(result).toEqual({ message: "Member removed.", ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant-members-TENANT001");
  });
});
