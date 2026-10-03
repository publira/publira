import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminCurrentUser,
  mockHasOtherActiveTenantAdmin,
  mockRedirectToLoginIfSessionRejected,
} = vi.hoisted(() => ({
  mockGetAdminCurrentUser: vi.fn(),
  mockHasOtherActiveTenantAdmin: vi.fn(),
  mockRedirectToLoginIfSessionRejected: vi.fn(),
}));

vi.mock("#lib/admin-auth", () => ({
  getAdminCurrentUser: mockGetAdminCurrentUser,
}));

vi.mock("#lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: mockRedirectToLoginIfSessionRejected,
}));

vi.mock("#lib/tenant-members", () => ({
  hasOtherActiveTenantAdmin: mockHasOtherActiveTenantAdmin,
}));

const signedInAs = (publicId: string) => ({
  ok: true,
  user: { name: "Avery Admin", publicId, role: "tenant_admin" },
});

const target = {
  id: "01920000-0000-7000-8000-000000000001",
  publicId: "TARGET00001",
  role: "tenant_admin",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminCurrentUser.mockResolvedValue(signedInAs("ADMIN000001"));
  mockHasOtherActiveTenantAdmin.mockResolvedValue({ ok: true, value: true });
});

describe("readerModerationRefusals", () => {
  it("refuses nothing on another administrator while one more is active", async () => {
    const { readerModerationRefusals } = await import("./moderation-refusals");

    expect(await readerModerationRefusals("TENANT001", "en", target)).toEqual({
      lastTenantAdmin: false,
      ownAccount: false,
    });
    expect(mockHasOtherActiveTenantAdmin).toHaveBeenCalledWith(
      "TENANT001",
      "en",
      target.id
    );
  });

  it("refuses the signed-in administrator's own account", async () => {
    mockGetAdminCurrentUser.mockResolvedValue(signedInAs(target.publicId));
    const { readerModerationRefusals } = await import("./moderation-refusals");

    expect(await readerModerationRefusals("TENANT001", "en", target)).toEqual({
      lastTenantAdmin: false,
      ownAccount: true,
    });
  });

  it("refuses the tenant's last active administrator", async () => {
    mockHasOtherActiveTenantAdmin.mockResolvedValue({ ok: true, value: false });
    const { readerModerationRefusals } = await import("./moderation-refusals");

    expect(await readerModerationRefusals("TENANT001", "en", target)).toEqual({
      lastTenantAdmin: true,
      ownAccount: false,
    });
  });

  it.each(["", "tenant_editor"])(
    "never looks for another administrator beside an account holding %j",
    async (role) => {
      const { readerModerationRefusals } =
        await import("./moderation-refusals");

      expect(
        await readerModerationRefusals("TENANT001", "en", { ...target, role })
      ).toEqual({ lastTenantAdmin: false, ownAccount: false });
      expect(mockHasOtherActiveTenantAdmin).not.toHaveBeenCalled();
    }
  );

  // The API still refuses what it refuses; the page only cannot say so first.
  it("refuses nothing it could not find out", async () => {
    mockGetAdminCurrentUser.mockResolvedValue({
      ok: false,
      requiresSignIn: false,
    });
    mockHasOtherActiveTenantAdmin.mockResolvedValue({
      message: "unavailable",
      ok: false,
      requiresSignIn: false,
    });
    const { readerModerationRefusals } = await import("./moderation-refusals");

    expect(await readerModerationRefusals("TENANT001", "en", target)).toEqual({
      lastTenantAdmin: false,
      ownAccount: false,
    });
  });

  it("hands both reads to the sign-in redirect", async () => {
    const rejected = { message: "", ok: false, requiresSignIn: true };
    mockHasOtherActiveTenantAdmin.mockResolvedValue(rejected);
    const { readerModerationRefusals } = await import("./moderation-refusals");

    await readerModerationRefusals("TENANT001", "en", target);

    expect(mockRedirectToLoginIfSessionRejected).toHaveBeenCalledWith(
      signedInAs("ADMIN000001"),
      rejected
    );
  });
});
