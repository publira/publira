import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAcceptInvitation,
  mockAssertSameOrigin,
  mockRedirect,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAcceptInvitation: vi.fn(),
  mockAssertSameOrigin: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/admin-auth", () => ({
  acceptTenantAdminInvitation: mockAcceptInvitation,
  tenantAdminInvitationCacheTag: (tenantId: string) =>
    `tenant-admin-invitation-${tenantId}`,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const TENANT_ID = "0194f3c0-0000-7000-8000-000000000001";
const TOKEN = "a".repeat(64);

const acceptFormData = (password: string, confirmPassword = password) => {
  const formData = new FormData();
  formData.set("tenant_id", TENANT_ID);
  formData.set("token", TOKEN);
  formData.set("account_exists", "false");
  formData.set("email", "invitee@example.com");
  formData.set("name", "Invitee");
  formData.set("password", password);
  formData.set("confirm_password", confirmPassword);
  return formData;
};

describe("acceptInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the password with the spaces the invitee typed around it", async () => {
    mockAcceptInvitation.mockResolvedValueOnce({
      accepted: true,
      accountCreated: true,
      ok: true,
    });

    const { acceptInviteAction } = await import("./actions");

    await expect(
      acceptInviteAction(null, acceptFormData("  correct horse  "))
    ).rejects.toThrow("NEXT_REDIRECT:/login?");
    expect(mockAcceptInvitation).toHaveBeenCalledWith(
      TENANT_ID,
      TOKEN,
      "en",
      "Invitee",
      "  correct horse  "
    );
  });

  it("tells apart a confirmation that differs only in its spaces", async () => {
    const { acceptInviteAction } = await import("./actions");

    await expect(
      acceptInviteAction(
        null,
        acceptFormData("correct horse ", "correct horse")
      )
    ).resolves.toEqual({
      message:
        "The passwords do not match. Enter the same password in both fields.",
      ok: false,
    });
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
  });

  it("clears the invitation read before sending the invitee to sign in", async () => {
    mockAcceptInvitation.mockResolvedValueOnce({
      accepted: true,
      accountCreated: true,
      ok: true,
    });

    const { acceptInviteAction } = await import("./actions");

    await expect(
      acceptInviteAction(null, acceptFormData("correct horse"))
    ).rejects.toThrow("NEXT_REDIRECT:/login?");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant-admin-invitation-${TENANT_ID}`
    );
  });

  it("leaves the invitation read alone when the API refuses the acceptance", async () => {
    mockAcceptInvitation.mockResolvedValueOnce({
      message: "This invitation has expired.",
      ok: false,
    });

    const { acceptInviteAction } = await import("./actions");

    await expect(
      acceptInviteAction(null, acceptFormData("correct horse"))
    ).resolves.toEqual({ message: "This invitation has expired.", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
