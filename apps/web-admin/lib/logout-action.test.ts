import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteCookie,
  mockGetAccessToken,
  mockLogoutAdmin,
  mockRedirect,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteCookie: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockLogoutAdmin: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    delete: mockDeleteCookie,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("./admin-auth", () => ({
  logoutAdmin: mockLogoutAdmin,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

describe("logoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("tok_abc");
  });

  it("upstream を revoke して Cookie を消し、ログインへ redirect する", async () => {
    const { logoutAction } = await import("./logout-action");

    await logoutAction("TENANT001");

    expect(mockGetAccessToken).toHaveBeenCalledOnce();
    expect(mockLogoutAdmin).toHaveBeenCalledWith("tok_abc", "TENANT001");
    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_admin_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith("admin-session-cookie");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("revoke が失敗しても Cookie 削除と redirect は行う", async () => {
    mockLogoutAdmin.mockRejectedValueOnce(new Error("upstream down"));

    const { logoutAction } = await import("./logout-action");

    await logoutAction("TENANT001");

    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_admin_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith("admin-session-cookie");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
