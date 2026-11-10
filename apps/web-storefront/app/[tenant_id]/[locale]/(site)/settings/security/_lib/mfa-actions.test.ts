import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "#lib/messages";
import type * as MfaModule from "#lib/mfa";

const {
  mockAssertSameOrigin,
  mockConfirmMyMfaEnrollment,
  mockDisableMyMfa,
  mockRedirect,
  mockRefresh,
  mockRegenerateMyMfaRecoveryCodes,
  mockRequirePublicSession,
  mockStartMyMfaEnrollment,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockConfirmMyMfaEnrollment: vi.fn(),
  mockDisableMyMfa: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRefresh: vi.fn(),
  mockRegenerateMyMfaRecoveryCodes: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockStartMyMfaEnrollment: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mockRefresh }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/mfa", async (importOriginal) => ({
  ...(await importOriginal<typeof MfaModule>()),
  confirmMyMfaEnrollment: mockConfirmMyMfaEnrollment,
  disableMyMfa: mockDisableMyMfa,
  regenerateMyMfaRecoveryCodes: mockRegenerateMyMfaRecoveryCodes,
  startMyMfaEnrollment: mockStartMyMfaEnrollment,
}));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: <Result>(
    _locale: string,
    _returnTo: string,
    run: () => Promise<Result>
  ) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({ getTenantDefaultLocale: () => "en" }));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessToken = "session-token";

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    locale: "en",
    tenantId,
    ...values,
  })) {
    data.set(name, value);
  }

  return data;
};

/** The flash the Action put on the `/settings/security` redirect it took. */
const lastFlash = () => {
  const path = mockRedirect.mock.calls.at(-1)?.[0] ?? "";
  const params = new URLSearchParams(path.slice(path.indexOf("?")));

  return {
    message: params.get("message"),
    path: path.slice(0, path.indexOf("?")),
    status: params.get("status"),
  };
};

const actions = () => import("./mfa-actions");

describe("two-step verification under Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("starts an enrollment with the code to scan and the key to type", async () => {
    const { startMfaEnrollmentAction } = await actions();
    mockStartMyMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      otpauthUri: "otpauth://totp/Site:reader%40example.com?secret=ABCDEF",
      secret: "ABCDEF",
    });

    const state = await startMfaEnrollmentAction(null, form({}));

    expect(state).toMatchObject({ message: "", ok: true, secret: "ABCDEF" });
    expect(state?.ok && state.qr.size).toBeGreaterThan(0);
    expect(mockStartMyMfaEnrollment).toHaveBeenCalledWith(
      tenantId,
      accessToken
    );
  });

  it("sends a member of staff with a console passkey to the console", async () => {
    const { startMfaEnrollmentAction } = await actions();
    const t = await getMessagesFor("en");
    mockStartMyMfaEnrollment.mockResolvedValueOnce({
      error: new ConnectError("console", Code.FailedPrecondition, undefined, [
        {
          desc: ErrorInfoSchema,
          value: { domain: "publira", reason: "MFA_SET_UP_IN_CONSOLE" },
        },
      ]),
      ok: false,
    });

    await expect(startMfaEnrollmentAction(null, form({}))).resolves.toEqual({
      message: t("storefront.settings.mfa_set_up_in_console"),
      ok: false,
    });
  });

  it("turns it on with a code and answers the recovery codes once", async () => {
    const { confirmMfaEnrollmentAction } = await actions();
    const t = await getMessagesFor("en");
    mockConfirmMyMfaEnrollment.mockResolvedValueOnce({
      ok: true,
      recoveryCodes: ["aaaaa-11111"],
    });

    await expect(
      confirmMfaEnrollmentAction(null, form({ code: " 123456 " }))
    ).resolves.toEqual({
      message: t("storefront.settings.mfa_enabled"),
      ok: true,
      recoveryCodes: ["aaaaa-11111"],
    });
    expect(mockConfirmMyMfaEnrollment).toHaveBeenCalledWith(
      tenantId,
      "123456",
      accessToken
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("stays on the confirm step on a wrong code", async () => {
    const { confirmMfaEnrollmentAction } = await actions();
    const t = await getMessagesFor("en");
    mockConfirmMyMfaEnrollment.mockResolvedValueOnce({
      code: "invalid_code",
      ok: false,
    });

    await expect(
      confirmMfaEnrollmentAction(null, form({ code: "000000" }))
    ).resolves.toEqual({
      message: t("storefront.auth.two_step.errors.invalid_code"),
      ok: false,
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("regenerates the recovery codes with a code from the authenticator", async () => {
    const { regenerateMfaRecoveryCodesAction } = await actions();
    const t = await getMessagesFor("en");
    mockRegenerateMyMfaRecoveryCodes.mockResolvedValueOnce({
      ok: true,
      recoveryCodes: ["ccccc-33333"],
    });

    await expect(
      regenerateMfaRecoveryCodesAction(null, form({ code: "123456" }))
    ).resolves.toEqual({
      message: t("storefront.settings.mfa_regenerated"),
      ok: true,
      recoveryCodes: ["ccccc-33333"],
    });
  });

  it("turns it off with the password and a code, back on Security", async () => {
    const { disableMfaAction } = await actions();
    const t = await getMessagesFor("en");
    mockDisableMyMfa.mockResolvedValueOnce({ ok: true });

    await expect(
      disableMfaAction(null, form({ code: "abcde-12345", password: "pw" }))
    ).rejects.toThrow("NEXT_REDIRECT:");
    expect(mockDisableMyMfa).toHaveBeenCalledWith(
      tenantId,
      "abcde-12345",
      { password: "pw" },
      accessToken
    );
    expect(lastFlash()).toEqual({
      message: t("storefront.settings.mfa_disabled"),
      path: "/settings/security",
      status: "success",
    });
  });

  it("says the password is wrong", async () => {
    const { disableMfaAction } = await actions();
    const t = await getMessagesFor("en");
    mockDisableMyMfa.mockResolvedValueOnce({
      error: new ConnectError("password", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "password" }] },
        },
      ]),
      ok: false,
    });

    await expect(
      disableMfaAction(null, form({ code: "123456", password: "wrong" }))
    ).resolves.toEqual({
      message: t("storefront.settings.mfa_disable_wrong_password"),
      ok: false,
    });
  });

  it("turns it off with a passkey for an account without a password", async () => {
    const { disableMfaWithPasskeyAction } = await actions();
    mockDisableMyMfa.mockResolvedValueOnce({ ok: true });

    await expect(
      disableMfaWithPasskeyAction(
        form({ code: "123456", passkeyCredential: '{"id":"cred"}' })
      )
    ).rejects.toThrow("NEXT_REDIRECT:");
    expect(mockDisableMyMfa).toHaveBeenCalledWith(
      tenantId,
      "123456",
      { passkeyCredential: '{"id":"cred"}' },
      accessToken
    );
  });

  it("turns away a provider confirmation that names no tenant, without looking one up", async () => {
    const { disableMfaWithProviderAction } = await actions();

    await expect(
      disableMfaWithProviderAction(
        form({ code: "123456", provider: "google", tenantId: "not-a-tenant" })
      )
    ).resolves.toBeUndefined();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
  });

  it("returns a provider confirmation without a code to Security", async () => {
    const { disableMfaWithProviderAction } = await actions();
    const t = await getMessagesFor("en");

    await expect(
      disableMfaWithProviderAction(form({ code: "", provider: "google" }))
    ).rejects.toThrow("NEXT_REDIRECT:");
    expect(lastFlash()).toEqual({
      message: t("storefront.settings.mfa_disable_failed"),
      path: "/settings/security",
      status: "error",
    });
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
  });

  it("asks for another passkey confirmation after a wrong code", async () => {
    const { disableMfaWithPasskeyAction } = await actions();
    const t = await getMessagesFor("en");
    mockDisableMyMfa.mockResolvedValueOnce({ code: "locked", ok: false });

    await expect(
      disableMfaWithPasskeyAction(
        form({ code: "123456", passkeyCredential: '{"id":"cred"}' })
      )
    ).resolves.toEqual({
      message: t("storefront.auth.two_step.errors.locked"),
      ok: false,
    });
  });
});
