import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteCookie,
  mockLogoutPlatform,
  mockRedirect,
  mockResolveAccessToken,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteCookie: vi.fn(),
  mockLogoutPlatform: vi.fn(),
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
  logoutPlatform: mockLogoutPlatform,
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

describe("logoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("tok_abc");
  });

  it("revokes upstream, clears the cookie, and redirects to login", async () => {
    const { logoutAction } = await import("./logout-action");

    await logoutAction();

    expect(mockResolveAccessToken).toHaveBeenCalledOnce();
    expect(mockLogoutPlatform).toHaveBeenCalledWith("tok_abc");
    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_platform_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform-session-cookie");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("clears the cookie and redirects even when revoke fails", async () => {
    mockLogoutPlatform.mockRejectedValueOnce(new Error("upstream down"));

    const { logoutAction } = await import("./logout-action");

    await logoutAction();

    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_platform_auth");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform-session-cookie");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
