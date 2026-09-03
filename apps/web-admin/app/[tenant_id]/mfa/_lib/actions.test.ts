import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockClearMfaChallenge,
  mockConfirmAdminMfaEnrollment,
  mockReadMfaChallenge,
  mockRedirect,
  mockStartAdminMfaEnrollment,
  mockToQrCodePath,
  mockVerifyAdminMfa,
  mockWriteAdminSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockClearMfaChallenge: vi.fn(),
  mockConfirmAdminMfaEnrollment: vi.fn(),
  mockReadMfaChallenge: vi.fn(),
  mockRedirect: vi.fn(),
  mockStartAdminMfaEnrollment: vi.fn(),
  mockToQrCodePath: vi.fn(),
  mockVerifyAdminMfa: vi.fn(),
  mockWriteAdminSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/action-messages", async () => {
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("ja"),
    getActionMessages: () => Promise.resolve(sharedCatalog("ja")),
  };
});

vi.mock("#lib/admin-mfa", () => ({
  confirmAdminMfaEnrollment: mockConfirmAdminMfaEnrollment,
  startAdminMfaEnrollment: mockStartAdminMfaEnrollment,
  verifyAdminMfa: mockVerifyAdminMfa,
}));

vi.mock("#lib/admin-session-cookie", () => ({
  writeAdminSessionCookie: mockWriteAdminSessionCookie,
}));

vi.mock("#lib/mfa-challenge", () => ({
  clearMfaChallenge: mockClearMfaChallenge,
  readMfaChallenge: mockReadMfaChallenge,
}));

vi.mock("#lib/qr-code", () => ({ toQrCodePath: mockToQrCodePath }));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const challenge = (kind: "enroll" | "verify") => ({
  challengeToken: "challenge-token",
  expiresAt: Temporal.Now.instant().add({ seconds: 300 }).toString(),
  kind,
  nextPath: "/series",
  tenantId: TENANT_ID,
});

/**
 * `redirect()` throws in Next.js, and every Action here relies on that to stop
 * where it is called. A mock that merely records the call would let execution
 * run on into code the redirect exists to skip.
 */
const redirectsTo = (path: string): string => `NEXT_REDIRECT:${path}`;

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

/** What `lib/admin-mfa.ts` hands back on success. */
const session = {
  accessToken: "session-token",
  expiresAt: Temporal.Instant.from("2026-09-03T00:00:00Z"),
};

describe("verifyMfaAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockReadMfaChallenge.mockResolvedValue(challenge("verify"));
    mockRedirect.mockImplementation((path: string) => {
      throw new Error(redirectsTo(path));
    });
  });

  it("takes the session an authenticator code earned and resumes the login", async () => {
    mockVerifyAdminMfa.mockResolvedValueOnce({
      ok: true,
      recoveryCodeUsed: false,
      remainingRecoveryCodes: 10,
      session,
    });

    const { verifyMfaAction } = await import("./actions");
    await expect(
      verifyMfaAction(null, formData({ code: "123456", tenant_id: TENANT_ID }))
    ).rejects.toThrow(redirectsTo("/series"));

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockVerifyAdminMfa).toHaveBeenCalledWith(
      TENANT_ID,
      "challenge-token",
      "123456",
      "ja"
    );
    expect(mockWriteAdminSessionCookie).toHaveBeenCalledWith(
      TENANT_ID,
      session
    );
    expect(mockClearMfaChallenge).toHaveBeenCalledOnce();
    expect(mockRedirect).toHaveBeenCalledWith("/series");
  });

  it("stops on a spent recovery code to report how many are left", async () => {
    mockVerifyAdminMfa.mockResolvedValueOnce({
      ok: true,
      recoveryCodeUsed: true,
      remainingRecoveryCodes: 9,
      session,
    });

    const { verifyMfaAction } = await import("./actions");
    const result = await verifyMfaAction(
      null,
      formData({ code: "ABCDE-FGHJK", tenant_id: TENANT_ID })
    );

    expect(result).toEqual({ ok: true, remainingRecoveryCodes: 9 });
    expect(mockWriteAdminSessionCookie).toHaveBeenCalledOnce();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("keeps a refused code on the form instead of ending the login", async () => {
    mockVerifyAdminMfa.mockResolvedValueOnce({
      challengeExpired: false,
      message: "コードが正しくありません。",
      ok: false,
    });

    const { verifyMfaAction } = await import("./actions");
    const result = await verifyMfaAction(
      null,
      formData({ code: "000000", tenant_id: TENANT_ID })
    );

    expect(result).toEqual({
      message: "コードが正しくありません。",
      ok: false,
    });
    expect(mockClearMfaChallenge).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("drops a challenge the API no longer honours and asks for the password again", async () => {
    mockVerifyAdminMfa.mockResolvedValueOnce({
      challengeExpired: true,
      message: "サインインの有効期限が切れました。",
      ok: false,
    });

    const { verifyMfaAction } = await import("./actions");
    await expect(
      verifyMfaAction(null, formData({ code: "123456", tenant_id: TENANT_ID }))
    ).rejects.toThrow(
      redirectsTo("/login?next=%2Fseries&reason=session_revoked")
    );

    expect(mockClearMfaChallenge).toHaveBeenCalledOnce();
  });

  it("sends a submission with no challenge behind it back to the sign-in screen", async () => {
    mockReadMfaChallenge.mockResolvedValue(null);

    const { verifyMfaAction } = await import("./actions");
    await expect(
      verifyMfaAction(null, formData({ code: "123456", tenant_id: TENANT_ID }))
    ).rejects.toThrow(redirectsTo("/login?next=%2F&reason=session_revoked"));

    expect(mockVerifyAdminMfa).not.toHaveBeenCalled();
  });

  it("refuses a form naming a tenant the challenge was not issued for", async () => {
    const { verifyMfaAction } = await import("./actions");
    await expect(
      verifyMfaAction(
        null,
        formData({
          code: "123456",
          tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        })
      )
    ).rejects.toThrow(
      redirectsTo("/login?next=%2Fseries&reason=session_revoked")
    );

    expect(mockVerifyAdminMfa).not.toHaveBeenCalled();
  });

  it("rejects an empty code without calling the API", async () => {
    const { verifyMfaAction } = await import("./actions");
    const result = await verifyMfaAction(
      null,
      formData({ code: "  ", tenant_id: TENANT_ID })
    );

    expect(result).toEqual({
      message: "コードを入力してください。",
      ok: false,
    });
    expect(mockVerifyAdminMfa).not.toHaveBeenCalled();
  });

  it("reports a session it could not store rather than resuming the login", async () => {
    mockVerifyAdminMfa.mockResolvedValueOnce({
      ok: true,
      recoveryCodeUsed: false,
      remainingRecoveryCodes: 10,
      session,
    });
    mockWriteAdminSessionCookie.mockRejectedValueOnce(new Error("no secret"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { verifyMfaAction } = await import("./actions");
    const result = await verifyMfaAction(
      null,
      formData({ code: "123456", tenant_id: TENANT_ID })
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockClearMfaChallenge).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("enrollment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockReadMfaChallenge.mockResolvedValue(challenge("enroll"));
    mockToQrCodePath.mockReturnValue({ path: "M4 4h1v1h-1z", size: 49 });
    mockRedirect.mockImplementation((path: string) => {
      throw new Error(redirectsTo(path));
    });
  });

  it("hands the screen the QR geometry for the secret the API minted", async () => {
    mockStartAdminMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      otpauthUri: "otpauth://totp/Publira:admin@example.com?secret=ABC",
      secret: "ABC",
    });

    const { startMfaEnrollmentAction } = await import("./actions");
    const result = await startMfaEnrollmentAction(
      null,
      formData({ tenant_id: TENANT_ID })
    );

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockToQrCodePath).toHaveBeenCalledWith(
      "otpauth://totp/Publira:admin@example.com?secret=ABC"
    );
    expect(result).toEqual({
      ok: true,
      qr: { path: "M4 4h1v1h-1z", size: 49 },
      secret: "ABC",
    });
  });

  it("refuses a verify challenge on the enrollment path", async () => {
    mockReadMfaChallenge.mockResolvedValue(challenge("verify"));

    const { startMfaEnrollmentAction } = await import("./actions");
    await expect(
      startMfaEnrollmentAction(null, formData({ tenant_id: TENANT_ID }))
    ).rejects.toThrow(
      redirectsTo("/login?next=%2Fseries&reason=session_revoked")
    );

    expect(mockStartAdminMfaEnrollment).not.toHaveBeenCalled();
  });

  it("keeps the recovery codes and signs the operator in", async () => {
    mockConfirmAdminMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      recoveryCodes: ["ABCDE-FGHJK"],
      session,
    });

    const { confirmMfaEnrollmentAction } = await import("./actions");
    const result = await confirmMfaEnrollmentAction(
      null,
      formData({ code: "123456", tenant_id: TENANT_ID })
    );

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      recoveryCodes: ["ABCDE-FGHJK"],
      signedIn: true,
    });
    expect(mockWriteAdminSessionCookie).toHaveBeenCalledWith(
      TENANT_ID,
      session
    );
    expect(mockClearMfaChallenge).toHaveBeenCalledOnce();
  });

  it("still shows the recovery codes when no session came back with them", async () => {
    mockConfirmAdminMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      recoveryCodes: ["ABCDE-FGHJK"],
      session: null,
    });

    const { confirmMfaEnrollmentAction } = await import("./actions");
    const result = await confirmMfaEnrollmentAction(
      null,
      formData({ code: "123456", tenant_id: TENANT_ID })
    );

    expect(result).toEqual({
      ok: true,
      recoveryCodes: ["ABCDE-FGHJK"],
      signedIn: false,
    });
    expect(mockWriteAdminSessionCookie).not.toHaveBeenCalled();
  });
});
