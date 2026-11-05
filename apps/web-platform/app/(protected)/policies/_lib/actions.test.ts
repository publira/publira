import { beforeEach, describe, expect, it, vi } from "vitest";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import type * as LocaleModule from "#lib/locale";
import { platformPolicyCacheTag } from "#lib/platform-policy";
import type * as PlatformPolicyModule from "#lib/platform-policy";

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
  const actual = await importOriginal<typeof LocaleModule>();

  return { ...actual, getPlatformLocale: () => Promise.resolve("en") };
});

vi.mock("#lib/platform-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof PlatformPolicyModule>();

  return {
    ...actual,
    updatePlatformSecurityPolicy: mockUpdatePlatformSecurityPolicy,
  };
});

vi.mock("#lib/platform-mfa", () => ({
  PLATFORM_MFA_STATUS_CACHE_TAG: "platform-mfa-status",
}));

const securityForm = (extra: Record<string, string> = {}): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    anonymous_read_images_per_10_seconds: "2400",
    anonymous_read_public_api_per_10_seconds: "640",
    anonymous_read_search_per_10_seconds: "80",
    coin_payment_per_day: "500",
    coin_payment_per_minute: "20",
    data_export_per_day: "1",
    data_export_per_hour: "1",
    disposable_email_domains_url: "",
    icon_change_per_day: "20",
    icon_change_per_minute: "5",
    identity_link_per_day: "20",
    identity_link_per_minute: "5",
    legal_page_agreement_per_day: "50",
    legal_page_agreement_per_minute: "10",
    login_attempts_per_account_per_day: "50",
    login_attempts_per_account_per_minute: "5",
    login_attempts_per_source_per_day: "300",
    login_attempts_per_source_per_hour: "60",
    mail_requests_per_address_per_day: "20",
    mail_requests_per_address_per_hour: "5",
    mail_requests_per_source_per_day: "150",
    mail_requests_per_source_per_hour: "30",
    mfa_required_for_platform_operator: "on",
    passkey_per_day: "50",
    passkey_per_minute: "10",
    password_verification_per_day: "50",
    password_verification_per_minute: "5",
    promotion_code_attempt_per_day: "30",
    promotion_code_attempt_per_minute: "5",
    purchase_checkout_per_day: "100",
    purchase_checkout_per_minute: "10",
    revision: "3",
    series_remainder_checkout_per_day: "50",
    series_remainder_checkout_per_minute: "10",
    store_purchase_confirmation_per_day: "100",
    store_purchase_confirmation_per_minute: "10",
    subscription_checkout_per_day: "50",
    subscription_checkout_per_minute: "10",
    wait_free_ticket_use_per_day: "100",
    wait_free_ticket_use_per_minute: "10",
    ...extra,
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
  it("saves the operator requirement and the read limits, and clears every read it changes", async () => {
    mockUpdatePlatformSecurityPolicy.mockResolvedValueOnce({ ok: true });

    const { updatePlatformSecurityPolicyAction } = await import("./actions");
    await expect(
      updatePlatformSecurityPolicyAction(null, securityForm())
    ).resolves.toMatchObject({ ok: true });

    expect(mockUpdatePlatformSecurityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        anonymousReadLimits: { images: 2400, publicApi: 640, search: 80 },
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

  it("saves every reader limit under the name the policy reads it by", async () => {
    mockUpdatePlatformSecurityPolicy.mockResolvedValueOnce({ ok: true });

    const { updatePlatformSecurityPolicyAction } = await import("./actions");
    await updatePlatformSecurityPolicyAction(null, securityForm());

    expect(mockUpdatePlatformSecurityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        coinPayment: { perDay: 500, perMinute: 20 },
        dataExport: { perDay: 1, perHour: 1 },
        iconChange: { perDay: 20, perMinute: 5 },
        identityLink: { perDay: 20, perMinute: 5 },
        legalPageAgreement: { perDay: 50, perMinute: 10 },
        passkey: { perDay: 50, perMinute: 10 },
        promotionCodeAttempt: { perDay: 30, perMinute: 5 },
        purchaseCheckout: { perDay: 100, perMinute: 10 },
        seriesRemainderCheckout: { perDay: 50, perMinute: 10 },
        subscriptionCheckout: { perDay: 50, perMinute: 10 },
      }),
      3n,
      "en"
    );
  });

  // An unticked checkbox submits nothing, which has to save the allowance off
  // rather than leave it as stored.
  it("saves the tenant coin allowance as the checkbox is", async () => {
    mockUpdatePlatformSecurityPolicy.mockResolvedValue({ ok: true });
    const { updatePlatformSecurityPolicyAction } = await import("./actions");

    await updatePlatformSecurityPolicyAction(
      null,
      securityForm({ tenant_coins_allowed: "on" })
    );
    expect(mockUpdatePlatformSecurityPolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantCoinsAllowed: true }),
      3n,
      "en"
    );

    await updatePlatformSecurityPolicyAction(null, securityForm());
    expect(mockUpdatePlatformSecurityPolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantCoinsAllowed: false }),
      3n,
      "en"
    );
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
