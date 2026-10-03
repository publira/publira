import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAdminCurrentUser, mockRedirectToLoginIfSessionRejected } =
  vi.hoisted(() => ({
    mockGetAdminCurrentUser: vi.fn(),
    mockRedirectToLoginIfSessionRejected: vi.fn(),
  }));

vi.mock("#lib/admin-auth", () => ({
  getAdminCurrentUser: mockGetAdminCurrentUser,
}));

vi.mock("#lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: mockRedirectToLoginIfSessionRejected,
}));

const signedInAs = {
  ok: true,
  user: { name: "Avery Admin", publicId: "ADMIN000001", role: "tenant_admin" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminCurrentUser.mockResolvedValue(signedInAs);
});

describe("isOwnAccount", () => {
  it("recognizes the account the administrator is signed in with", async () => {
    const { isOwnAccount } = await import("./own-account");

    expect(await isOwnAccount("TENANT001", "ADMIN000001")).toBe(true);
    expect(mockGetAdminCurrentUser).toHaveBeenCalledWith("TENANT001");
  });

  it("answers no for any other account", async () => {
    const { isOwnAccount } = await import("./own-account");

    expect(await isOwnAccount("TENANT001", "READER00001")).toBe(false);
  });

  // The API still refuses what it refuses; the page only cannot say so first.
  it("answers no when the signed-in administrator could not be read", async () => {
    mockGetAdminCurrentUser.mockResolvedValue({
      ok: false,
      requiresSignIn: false,
    });
    const { isOwnAccount } = await import("./own-account");

    expect(await isOwnAccount("TENANT001", "ADMIN000001")).toBe(false);
  });

  it("hands the read to the sign-in redirect", async () => {
    const rejected = { ok: false, requiresSignIn: true };
    mockGetAdminCurrentUser.mockResolvedValue(rejected);
    const { isOwnAccount } = await import("./own-account");

    await isOwnAccount("TENANT001", "ADMIN000001");

    expect(mockRedirectToLoginIfSessionRejected).toHaveBeenCalledWith(rejected);
  });
});
