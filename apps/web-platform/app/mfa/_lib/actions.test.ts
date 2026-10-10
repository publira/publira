import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "#lib/messages";

const {
  mockAssertSameOrigin,
  mockClearMfaChallenge,
  mockConfirmPlatformMfaEnrollment,
  mockFinishMfaChallenge,
  mockReadMfaChallenge,
  mockRedirect,
  mockStartPlatformMfaEnrollment,
  mockToQrCodePath,
  mockVerifyPlatformMfa,
  mockWritePlatformSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockClearMfaChallenge: vi.fn(),
  mockConfirmPlatformMfaEnrollment: vi.fn(),
  mockFinishMfaChallenge: vi.fn(),
  mockReadMfaChallenge: vi.fn(),
  mockRedirect: vi.fn(),
  mockStartPlatformMfaEnrollment: vi.fn(),
  mockToQrCodePath: vi.fn(),
  mockVerifyPlatformMfa: vi.fn(),
  mockWritePlatformSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: () => Promise.resolve("en") };
});

vi.mock("#lib/platform-mfa", () => ({
  confirmPlatformMfaEnrollment: mockConfirmPlatformMfaEnrollment,
  startPlatformMfaEnrollment: mockStartPlatformMfaEnrollment,
  verifyPlatformMfa: mockVerifyPlatformMfa,
}));

vi.mock("#lib/platform-session-cookie", () => ({
  writePlatformSessionCookie: mockWritePlatformSessionCookie,
}));

vi.mock("#lib/mfa-challenge", () => ({
  clearMfaChallenge: mockClearMfaChallenge,
  finishMfaChallenge: mockFinishMfaChallenge,
  readMfaChallenge: mockReadMfaChallenge,
}));

vi.mock("@publira/ui-components/qr-code", () => ({
  toQrCodePath: mockToQrCodePath,
}));

const challenge = (kind: "enroll" | "verify") => ({
  challengeToken: "challenge-token",
  expiresAt: Temporal.Now.instant().add({ seconds: 300 }).toString(),
  kind,
  nextPath: "/tenants",
});

/**
 * `redirect()` throws in Next.js, and every Action here relies on that to stop
 * where it is called. A mock that merely records the call would let execution
 * run on into code the redirect exists to skip.
 */
const redirectsTo = (path: string): string => `NEXT_REDIRECT:${path}`;

const codeForm = (code: string): FormData => {
  const data = new FormData();
  data.set("code", code);
  return data;
};

const session = {
  accessToken: "session-token",
  expiresAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockRedirect.mockImplementation((path: string) => {
    throw new Error(redirectsTo(path));
  });
});

describe("verifyMfaAction", () => {
  beforeEach(() => {
    mockReadMfaChallenge.mockResolvedValue(challenge("verify"));
  });

  it("takes the session an authenticator code earned and resumes the sign-in", async () => {
    mockVerifyPlatformMfa.mockResolvedValueOnce({
      ok: true,
      recoveryCodeUsed: false,
      remainingRecoveryCodes: 10,
      session,
    });

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("123456"))).rejects.toThrow(
      redirectsTo("/tenants")
    );

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockVerifyPlatformMfa).toHaveBeenCalledWith(
      "challenge-token",
      "123456",
      "en"
    );
    expect(mockWritePlatformSessionCookie).toHaveBeenCalledWith(session);
    expect(mockClearMfaChallenge).toHaveBeenCalledOnce();
  });

  // A spent recovery code is one the operator can never use again, so the
  // screen stays to say how many are left rather than moving on.
  it("stays on /mfa to say how many recovery codes are left", async () => {
    mockVerifyPlatformMfa.mockResolvedValueOnce({
      ok: true,
      recoveryCodeUsed: true,
      remainingRecoveryCodes: 9,
      session,
    });
    const t = await getMessagesFor("en");

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("abcd-efgh"))).resolves.toEqual(
      {
        message: t("platform.auth.mfa.recovery_used_description", { count: 9 }),
        ok: true,
      }
    );
    expect(mockWritePlatformSessionCookie).toHaveBeenCalledWith(session);
    expect(mockFinishMfaChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeToken: "challenge-token",
        kind: "verify",
        nextPath: "/tenants",
      })
    );
    expect(mockClearMfaChallenge).not.toHaveBeenCalled();
  });

  it("keeps a wrong code on the form", async () => {
    mockVerifyPlatformMfa.mockResolvedValueOnce({
      challengeExpired: false,
      message: "The code is incorrect.",
      ok: false,
    });

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("000000"))).resolves.toEqual({
      message: "The code is incorrect.",
      ok: false,
    });
    expect(mockClearMfaChallenge).not.toHaveBeenCalled();
  });

  it("asks for the password again once the challenge has run out", async () => {
    mockVerifyPlatformMfa.mockResolvedValueOnce({
      challengeExpired: true,
      message: "expired",
      ok: false,
    });

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("123456"))).rejects.toThrow(
      redirectsTo("/login?next=%2Ftenants&reason=session_revoked")
    );
    expect(mockClearMfaChallenge).toHaveBeenCalledOnce();
  });

  it("refuses an empty code before calling the API", async () => {
    const t = await getMessagesFor("en");

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("  "))).resolves.toEqual({
      message: t("platform.auth.mfa.code_required"),
      ok: false,
    });
    expect(mockVerifyPlatformMfa).not.toHaveBeenCalled();
  });

  it("sends a submission with no challenge behind it back to sign-in", async () => {
    mockReadMfaChallenge.mockResolvedValue(null);

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("123456"))).rejects.toThrow(
      redirectsTo("/login?next=%2F&reason=session_revoked")
    );
    expect(mockVerifyPlatformMfa).not.toHaveBeenCalled();
  });

  it("does not spend an enroll challenge on a verification", async () => {
    mockReadMfaChallenge.mockResolvedValue(challenge("enroll"));

    const { verifyMfaAction } = await import("./actions");
    await expect(verifyMfaAction(null, codeForm("123456"))).rejects.toThrow(
      redirectsTo("/login?next=%2Ftenants&reason=session_revoked")
    );
    expect(mockVerifyPlatformMfa).not.toHaveBeenCalled();
  });
});

describe("enrollment Actions", () => {
  beforeEach(() => {
    mockReadMfaChallenge.mockResolvedValue(challenge("enroll"));
  });

  it("starts an enrollment with the challenge and draws its QR code", async () => {
    mockStartPlatformMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      otpauthUri: "otpauth://totp/x",
      secret: "SECRET",
    });
    mockToQrCodePath.mockReturnValueOnce({ path: "M0 0", size: 21 });

    const { startMfaEnrollmentAction } = await import("./actions");
    await expect(
      startMfaEnrollmentAction(null, new FormData())
    ).resolves.toEqual({
      message: "",
      ok: true,
      qr: { path: "M0 0", size: 21 },
      secret: "SECRET",
    });
    expect(mockStartPlatformMfaEnrollment).toHaveBeenCalledWith(
      "challenge-token",
      "en"
    );
  });

  // The recovery codes exist in this response alone, so the challenge is
  // marked finished rather than cleared: `/mfa` renders again to show them.
  it("finishes the sign-in with the session the enrollment earned", async () => {
    mockConfirmPlatformMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      recoveryCodes: ["code-1", "code-2"],
      session,
    });

    const { confirmMfaEnrollmentAction } = await import("./actions");
    await expect(
      confirmMfaEnrollmentAction(null, codeForm("123456"))
    ).resolves.toEqual({
      message: "",
      ok: true,
      recoveryCodes: ["code-1", "code-2"],
      signedIn: true,
    });
    expect(mockWritePlatformSessionCookie).toHaveBeenCalledWith(session);
    expect(mockFinishMfaChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeToken: "challenge-token",
        kind: "enroll",
        nextPath: "/tenants",
      })
    );
  });

  it("still shows the codes when no session came with them", async () => {
    mockConfirmPlatformMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      recoveryCodes: ["code-1"],
      session: null,
    });

    const { confirmMfaEnrollmentAction } = await import("./actions");
    await expect(
      confirmMfaEnrollmentAction(null, codeForm("123456"))
    ).resolves.toMatchObject({ ok: true, signedIn: false });
    expect(mockWritePlatformSessionCookie).not.toHaveBeenCalled();
  });
});
