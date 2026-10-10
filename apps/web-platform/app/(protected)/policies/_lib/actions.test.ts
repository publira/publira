import { beforeEach, describe, expect, it, vi } from "vitest";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { platformPolicyCacheTag } from "#lib/platform-policy";

const {
  mockAssertSameOrigin,
  mockUpdatePlatformSecurityPolicy,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockUpdatePlatformSecurityPolicy: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withPlatformSessionReauth: <T>(run: () => Promise<T>) => run(),
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: () => Promise.resolve("en") };
});

vi.mock("#lib/platform-policy", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    updatePlatformSecurityPolicy: mockUpdatePlatformSecurityPolicy,
  };
});

vi.mock("#lib/platform-mfa", () => ({
  PLATFORM_MFA_STATUS_CACHE_TAG: "platform-mfa-status",
}));

const securityForm = (): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    disposable_email_domains_url: "",
    login_attempts_per_account_per_day: "50",
    login_attempts_per_account_per_minute: "5",
    login_attempts_per_source_per_day: "300",
    login_attempts_per_source_per_hour: "60",
    mail_requests_per_address_per_day: "20",
    mail_requests_per_address_per_hour: "5",
    mail_requests_per_source_per_day: "150",
    mail_requests_per_source_per_hour: "30",
    mfa_required_for_platform_operator: "on",
    password_verification_per_day: "50",
    password_verification_per_minute: "5",
    revision: "3",
    store_purchase_confirmation_per_day: "100",
    store_purchase_confirmation_per_minute: "10",
    wait_free_ticket_use_per_day: "100",
    wait_free_ticket_use_per_minute: "10",
  })) {
    data.set(name, value);
  }
  return data;
};

describe("updatePlatformSecurityPolicyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // The account screen's status read answers whether the platform requires
  // two-step verification, so a save that may have switched it clears that
  // read along with the policy and the audit log.
  it("saves the operator requirement and clears every read it changes", async () => {
    mockUpdatePlatformSecurityPolicy.mockResolvedValueOnce({ ok: true });

    const { updatePlatformSecurityPolicyAction } = await import("./actions");
    await expect(
      updatePlatformSecurityPolicyAction(null, securityForm())
    ).resolves.toMatchObject({ ok: true });

    expect(mockUpdatePlatformSecurityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        mfaRequiredForPlatformOperator: true,
        mfaRequiredForTenantAdmin: false,
      }),
      3n,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(platformPolicyCacheTag);
    expect(mockUpdateTag).toHaveBeenCalledWith(platformAuditLogsCacheTag);
    expect(mockUpdateTag).toHaveBeenCalledWith("platform-mfa-status");
  });

  it("clears nothing when the save is refused", async () => {
    mockUpdatePlatformSecurityPolicy.mockResolvedValueOnce({
      message: "conflict",
      ok: false,
    });

    const { updatePlatformSecurityPolicyAction } = await import("./actions");
    await expect(
      updatePlatformSecurityPolicyAction(null, securityForm())
    ).resolves.toEqual({ message: "conflict", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
