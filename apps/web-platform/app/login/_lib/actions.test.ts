import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "#lib/messages";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockLoginPlatform,
  mockRedirect,
  mockWriteMfaChallenge,
  mockWritePlatformSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockLoginPlatform: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockWriteMfaChallenge: vi.fn(),
  mockWritePlatformSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth", () => ({ loginPlatform: mockLoginPlatform }));

vi.mock("#lib/mfa-challenge", () => ({
  MFA_PATH: "/mfa",
  writeMfaChallenge: mockWriteMfaChallenge,
}));

vi.mock("#lib/platform-session-cookie", () => ({
  writePlatformSessionCookie: mockWritePlatformSessionCookie,
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

  it("writes the session cookie before redirecting", async () => {
    const session = {
      accessToken: "session-token",
      expiresAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
    };
    mockLoginPlatform.mockResolvedValueOnce({
      kind: "session",
      ok: true,
      session,
    });

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/tenants"
    );
    expect(mockWritePlatformSessionCookie).toHaveBeenCalledWith(session);
    expect(mockWriteMfaChallenge).not.toHaveBeenCalled();
  });

  // The password alone earns no session here, so nothing is written but the
  // challenge `/mfa` spends, and the destination travels with it.
  it("holds a sign-in that owes a second factor at /mfa", async () => {
    mockLoginPlatform.mockResolvedValueOnce({
      challengeKind: "enroll",
      challengeToken: "challenge-token",
      expiresAt: Temporal.Instant.from("2026-10-01T00:05:00Z"),
      kind: "challenge",
      ok: true,
    });

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/mfa"
    );
    expect(mockWriteMfaChallenge).toHaveBeenCalledWith({
      challengeToken: "challenge-token",
      expiresAt: "2026-10-01T00:05:00Z",
      kind: "enroll",
      nextPath: "/tenants",
    });
    expect(mockWritePlatformSessionCookie).not.toHaveBeenCalled();
  });

  it("does not blame the password for a response the console cannot hold", async () => {
    mockLoginPlatform.mockResolvedValueOnce({
      ok: false,
      refusal: "processing",
    });
    const t = await getMessagesFor("en");

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).resolves.toEqual({
      message: t("platform.auth.login.processing_failed"),
      ok: false,
    });
  });

  it("writes nothing when the credentials are rejected", async () => {
    mockLoginPlatform.mockResolvedValueOnce({
      ok: false,
      refusal: "credentials",
    });
    const t = await getMessagesFor("en");

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).resolves.toEqual({
      message: t("platform.auth.login.failed"),
      ok: false,
    });
    expect(mockWritePlatformSessionCookie).not.toHaveBeenCalled();
    expect(mockWriteMfaChallenge).not.toHaveBeenCalled();
  });

  it("asks the operator to wait, not to check their password, after too many attempts", async () => {
    mockLoginPlatform.mockResolvedValueOnce({
      ok: false,
      refusal: "rate-limited",
    });
    const t = await getMessagesFor("en");

    const { loginAction } = await import("./actions");

    await expect(loginAction(null, loginFormData())).resolves.toEqual({
      message: t("errors.rpc.rate-limited"),
      ok: false,
    });
    expect(mockWritePlatformSessionCookie).not.toHaveBeenCalled();
  });
});
