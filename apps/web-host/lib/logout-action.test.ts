import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteCookie,
  mockLogoutPublic,
  mockRedirect,
  mockResolveAccessToken,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
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
  logoutPublic: mockLogoutPublic,
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("./auth-shared", () => ({
  PUBLIC_SESSION_COOKIE_NAME: "publira_web_host_auth",
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

    await logoutAction("TENANT001", "ja");

    expect(mockResolveAccessToken).toHaveBeenCalledOnce();
    expect(mockLogoutPublic).toHaveBeenCalledWith("tok_abc", "TENANT001");
    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_host_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "public-session-cookie-publira_web_host_auth"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/ja/login");
  });

  it("revoke が失敗しても Cookie 削除と redirect は行う", async () => {
    mockLogoutPublic.mockRejectedValueOnce(new Error("upstream down"));

    const { logoutAction } = await import("./logout-action");

    await logoutAction("TENANT001", "en");

    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_host_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "public-session-cookie-publira_web_host_auth"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/en/login");
  });
});
