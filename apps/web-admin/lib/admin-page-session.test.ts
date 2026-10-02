import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetLocale, mockGetTenantId, mockVerifyAdminSession } = vi.hoisted(
  () => ({
    mockGetLocale: vi.fn(),
    mockGetTenantId: vi.fn(),
    mockVerifyAdminSession: vi.fn(),
  })
);

vi.mock("./tenant-id", () => ({ getTenantId: mockGetTenantId }));
vi.mock("./locale", () => ({ getLocale: mockGetLocale }));
vi.mock("./auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTenantId.mockResolvedValue("TENANT001");
  mockGetLocale.mockResolvedValue("en");
  mockVerifyAdminSession.mockResolvedValue({
    name: "Example Operator",
    publicId: "USER001",
    role: "editor",
  });
});

describe("verifyAdminPageSession", () => {
  it("answers the screen's tenant and locale once the operator is confirmed for that tenant", async () => {
    const { verifyAdminPageSession } = await import("./admin-page-session");

    await expect(verifyAdminPageSession()).resolves.toEqual({
      locale: "en",
      tenantId: "TENANT001",
    });
    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
    expect(mockGetLocale).toHaveBeenCalledWith("TENANT001");
  });

  it("sends a rejected session to the login even when the locale cannot be read either", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mockVerifyAdminSession.mockRejectedValueOnce(redirect);
    mockGetLocale.mockRejectedValueOnce(
      new Error("tenant default locale is unavailable")
    );

    const { verifyAdminPageSession } = await import("./admin-page-session");

    await expect(verifyAdminPageSession()).rejects.toBe(redirect);
    expect(mockGetLocale).not.toHaveBeenCalled();
  });

  it("lets the login redirect through", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mockVerifyAdminSession.mockRejectedValueOnce(redirect);

    const { verifyAdminPageSession } = await import("./admin-page-session");

    await expect(verifyAdminPageSession()).rejects.toBe(redirect);
  });
});
