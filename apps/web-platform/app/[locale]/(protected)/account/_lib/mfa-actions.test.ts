import { beforeEach, describe, expect, it, vi } from "vitest";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import type * as LocaleModule from "#lib/locale";

const {
  mockAssertSameOrigin,
  mockConfirmPlatformMfaEnrollment,
  mockDisablePlatformMfa,
  mockRegeneratePlatformMfaRecoveryCodes,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockConfirmPlatformMfaEnrollment: vi.fn(),
  mockDisablePlatformMfa: vi.fn(),
  mockRegeneratePlatformMfaRecoveryCodes: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withPlatformSessionReauth: <T>(run: () => Promise<T>) => run(),
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = await importOriginal<typeof LocaleModule>();

  return { ...actual, getPlatformLocale: () => Promise.resolve("en") };
});

vi.mock("#lib/platform-mfa", () => ({
  PLATFORM_MFA_STATUS_CACHE_TAG: "platform-mfa-status",
  confirmPlatformMfaEnrollment: mockConfirmPlatformMfaEnrollment,
  disablePlatformMfa: mockDisablePlatformMfa,
  regeneratePlatformMfaRecoveryCodes: mockRegeneratePlatformMfaRecoveryCodes,
  startPlatformMfaEnrollment: vi.fn(),
}));

const codeForm = (code: string): FormData => {
  const data = new FormData();
  data.set("code", code);

  return data;
};

const refused = { message: "The code is incorrect.", ok: false } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

/**
 * Each of these presents a code, and the API records the attempt in the audit
 * log whatever it came to. The status read changes only on success, but the
 * two are cleared together, as the other audited Actions clear theirs after
 * the call rather than after its success.
 */
describe("account MFA Actions", () => {
  it.each([
    [
      "confirmAccountMfaEnrollmentAction",
      () =>
        mockConfirmPlatformMfaEnrollment.mockResolvedValueOnce({
          ok: true,
          recoveryCodes: ["code-1"],
          session: null,
        }),
      () => mockConfirmPlatformMfaEnrollment.mockResolvedValueOnce(refused),
    ],
    [
      "regenerateAccountMfaRecoveryCodesAction",
      () =>
        mockRegeneratePlatformMfaRecoveryCodes.mockResolvedValueOnce({
          ok: true,
          recoveryCodes: ["code-1"],
        }),
      () =>
        mockRegeneratePlatformMfaRecoveryCodes.mockResolvedValueOnce(refused),
    ],
    [
      "disableAccountMfaAction",
      () => mockDisablePlatformMfa.mockResolvedValueOnce({ ok: true }),
      () => mockDisablePlatformMfa.mockResolvedValueOnce(refused),
    ],
  ] as const)(
    "%s clears the status and the audit log whether or not the code was right",
    async (name, succeed, refuse) => {
      const actions = await import("./mfa-actions");

      // SAFETY: each named Action takes the form state and the form data and
      // answers a result carrying `ok`; their state types differ, which is all
      // that keeps the union of them from being called directly.
      const action = actions[name] as (
        state: null,
        formData: FormData
      ) => Promise<{ ok: boolean }>;

      succeed();
      await expect(action(null, codeForm("123456"))).resolves.toMatchObject({
        ok: true,
      });
      expect(mockUpdateTag).toHaveBeenCalledWith("platform-mfa-status");
      expect(mockUpdateTag).toHaveBeenCalledWith(platformAuditLogsCacheTag);

      mockUpdateTag.mockClear();
      refuse();
      await expect(action(null, codeForm("000000"))).resolves.toEqual(refused);
      expect(mockUpdateTag).toHaveBeenCalledWith(platformAuditLogsCacheTag);
    }
  );

  it("clears nothing when no code was typed, since nothing reached the API", async () => {
    const { disableAccountMfaAction } = await import("./mfa-actions");

    await expect(
      disableAccountMfaAction(null, codeForm("  "))
    ).resolves.toMatchObject({ ok: false });
    expect(mockDisablePlatformMfa).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
