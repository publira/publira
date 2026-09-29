import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockLoginPlatform,
  mockRedirect,
  mockSetCookie,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockLoginPlatform: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockSetCookie: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("@publira/web-session", () => ({
  encryptSessionPayload: () => Promise.resolve("sealed-session"),
  resolveAuthSecret: () => "auth-secret",
  sessionCookieOptions: () => ({ httpOnly: true }),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: mockSetCookie }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth", () => ({
  PLATFORM_SESSION_COOKIE_NAME: "publira_web_platform_auth",
  loginPlatform: mockLoginPlatform,
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: mockGetPlatformLocale };
});

const loginFormData = (): FormData => {
  const formData = new FormData();
  formData.set("email", "operator@example.com");
  formData.set("next", "/tenants");
  formData.set("password", "correct horse battery staple");
  return formData;
};

describe("loginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("writes the session cookie and clears the session read's tag before redirecting", async () => {
    mockLoginPlatform.mockResolvedValueOnce({
      accessToken: "session-token",
      expiresAt: { toISOString: () => "2026-10-01T00:00:00Z" },
    });

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/tenants"
    );
    expect(mockSetCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "publira_web_platform_auth",
        value: "sealed-session",
      })
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform-session-cookie");
  });

  it("leaves the cookie and the tag alone when the credentials are rejected", async () => {
    mockLoginPlatform.mockResolvedValueOnce(null);

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).resolves.toMatchObject({
      ok: false,
    });
    expect(mockSetCookie).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
