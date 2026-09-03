import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantDefaultLocale, mockRedirect, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockGetTenantDefaultLocale: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("./api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("./tenant", () => ({
  getTenantDefaultLocale: mockGetTenantDefaultLocale,
}));

const importAuthSession = () => import("./auth-session");
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("web-host auth-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDefaultLocale.mockResolvedValue("ja");
  });

  it("redirectToLogin sends sanitized returnTo and revocation reason to /login", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin("ja", "/settings", tenantId)).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?returnTo=%2Fsettings&reason=session_revoked"
    );
  });

  it("redirectToLogin does not return to external URL", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(
      redirectToLogin("en", "https://evil.example.com", tenantId)
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/en/login?returnTo=%2F&reason=session_revoked"
    );
  });

  it("requirePublicSession returns the token if available", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("session-token");
    const { requirePublicSession } = await importAuthSession();

    await expect(requirePublicSession("ja", "/my", tenantId)).resolves.toBe(
      "session-token"
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("requirePublicSession sends you to re-login if there is no token", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    const { requirePublicSession } = await importAuthSession();

    await expect(requirePublicSession("ja", "/my", tenantId)).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?returnTo=%2Fmy&reason=session_revoked"
    );
  });

  it("withPublicSessionReauth returns the success value as is", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    await expect(
      withPublicSessionReauth(
        "ja",
        "/settings",
        () => Promise.resolve("ok"),
        tenantId
      )
    ).resolves.toBe("ok");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPublicSessionReauth sends re-login only when Unauthenticated", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    await expect(
      withPublicSessionReauth(
        "en",
        "/settings",
        () =>
          Promise.reject(
            new ConnectError("invalid token", Code.Unauthenticated)
          ),
        tenantId
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/en/login?returnTo=%2Fsettings&reason=session_revoked"
    );
  });

  it("withPublicSessionReauth does not treat business errors as re-authentication", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    // A wrong password reaches the client as invalid_argument; turning it
    // into a re-login would log a reader out over a typo.
    await expect(
      withPublicSessionReauth(
        "ja",
        "/settings",
        () =>
          Promise.reject(
            new ConnectError("invalid password", Code.InvalidArgument)
          ),
        tenantId
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPublicSessionReauth also propagates non-RPC failures", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    await expect(
      withPublicSessionReauth(
        "ja",
        "/settings",
        () => Promise.reject(new Error("boom")),
        tenantId
      )
    ).rejects.toThrow("boom");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
