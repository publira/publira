import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHeaders, mockRedirect, mockResolveAccessToken } = vi.hoisted(
  () => ({
    mockHeaders: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    mockResolveAccessToken: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: mockHeaders,
}));

vi.mock("./api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

const setReturnTo = (value?: string) => {
  mockHeaders.mockResolvedValue(
    new Headers(value === undefined ? {} : { "x-publira-return-to": value })
  );
};

const importAuthSession = () => import("./auth-session");

describe("web-platform auth-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setReturnTo("/tenants?token=abc");
  });

  it("redirects to /login with the proxy-recorded path and expiry reason", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("does not use an external URL as the redirect target", async () => {
    setReturnTo("https://evil.example.com");
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2F&reason=session_revoked"
    );
  });

  it("redirects to the console root when there is no header", async () => {
    setReturnTo();
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2F&reason=session_revoked"
    );
  });

  it("redirects only expired reads to login", async () => {
    const { redirectToLoginIfSessionRejected } = await importAuthSession();

    // Any one of the reads a screen awaits is enough to end the session.
    await expect(
      redirectToLoginIfSessionRejected(
        { ok: true },
        { ok: false, requiresSignIn: true }
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    mockRedirect.mockClear();
    await redirectToLoginIfSessionRejected(
      { ok: false, requiresSignIn: false },
      { ok: true }
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns the token when requirePlatformSession finds one", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("session-token");
    const { requirePlatformSession } = await importAuthSession();

    await expect(requirePlatformSession()).resolves.toBe("session-token");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to login when requirePlatformSession finds no token", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    const { requirePlatformSession } = await importAuthSession();

    await expect(requirePlatformSession()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("returns successful values unchanged", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(
      withPlatformSessionReauth(() => Promise.resolve("ok"))
    ).resolves.toBe("ok");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to login only for Unauthenticated errors", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(
      withPlatformSessionReauth(() =>
        Promise.reject(new ConnectError("invalid token", Code.Unauthenticated))
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("does not treat business errors as reauthentication errors", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    // A wrong current password reaches the client as invalid_argument;
    // turning it into a re-login would log the operator out over a typo.
    await expect(
      withPlatformSessionReauth(() =>
        Promise.reject(
          new ConnectError("invalid current password", Code.InvalidArgument)
        )
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("propagates non-RPC errors", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(
      withPlatformSessionReauth(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to login without calling RPC when there is no cookie", async () => {
    // A missing cookie never reaches the API, so the mutation would answer with
    // the form error this flow replaces instead of throwing Unauthenticated.
    mockResolveAccessToken.mockResolvedValue("");
    const run = vi.fn();
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(withPlatformSessionReauth(run)).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(run).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });
});
