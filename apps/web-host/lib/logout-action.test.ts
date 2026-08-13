import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteCookie,
  mockLogoutPublic,
  mockRedirect,
  mockResolveAccessToken,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockDeleteCookie: vi.fn(),
  mockLogoutPublic: vi.fn(),
  mockRedirect: vi.fn(),
  mockResolveAccessToken: vi.fn(),
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

vi.mock("./api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("./auth", () => ({
  PUBLIC_SESSION_COOKIE_NAME: "publira_web_host_auth",
  logoutPublic: mockLogoutPublic,
}));

vi.mock("./auth-shared", () => ({
  getPublicSessionCacheTag: (cookieName: string) =>
    `public-session-cookie-${cookieName}`,
}));

describe("logoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("tok_abc");
  });

  it("upstream を revoke して Cookie を消し、ログインへ redirect する", async () => {
    const { logoutAction } = await import("./logout-action");

    await logoutAction("TENANT001");

    expect(mockResolveAccessToken).toHaveBeenCalledOnce();
    expect(mockLogoutPublic).toHaveBeenCalledWith("tok_abc", "TENANT001");
    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_host_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "public-session-cookie-publira_web_host_auth"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("revoke が失敗しても Cookie 削除と redirect は行う", async () => {
    mockLogoutPublic.mockRejectedValueOnce(new Error("upstream down"));

    const { logoutAction } = await import("./logout-action");

    await logoutAction("TENANT001");

    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_host_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "public-session-cookie-publira_web_host_auth"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
