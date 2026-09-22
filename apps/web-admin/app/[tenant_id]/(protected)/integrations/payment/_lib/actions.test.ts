import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantPaymentSettings,
  mockUpdateTenantPurchaseSettings,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantPaymentSettings: vi.fn(),
  mockUpdateTenantPurchaseSettings: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/payment-settings", () => ({
  SECRET_UPDATE_MODE_REPLACE: 2,
  SECRET_UPDATE_MODE_UNCHANGED: 1,
  tenantPaymentSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:payment-settings`,
  updateTenantPaymentSettings: mockUpdateTenantPaymentSettings,
}));

vi.mock("#lib/tenant-purchase-settings", () => ({
  tenantPurchaseSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:purchase-settings`,
  updateTenantPurchaseSettings: mockUpdateTenantPurchaseSettings,
}));

const textFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

const storedPaymentSettings = {
  enabled: true,
  provider: "stripe",
  ready: true,
  secretKeyConfigured: true,
  secretKeyHint: "sk_test_••••••••KLMN",
  webhookSecretConfigured: true,
  webhookSecretHint: "whsec_••••••••WXYZ",
};

describe("updateTenantPaymentSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("replaces and saves the secret, then revalidates the cache tag", async () => {
    mockUpdateTenantPaymentSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedPaymentSettings,
    });

    const { updateTenantPaymentSettingsAction } = await import("./actions");

    const result = await updateTenantPaymentSettingsAction(
      null,
      textFormData({
        enabled: "on",
        secret_key: "sk_test_51NEW",
        tenant_id: "TENANT001",
        webhook_secret: "whsec_NEW",
      })
    );

    expect(result).toEqual({
      message: "The payment settings were saved.",
      ok: true,
      settings: storedPaymentSettings,
    });
    expect(mockUpdateTenantPaymentSettings).toHaveBeenCalledWith(
      {
        enabled: true,
        secretKey: "sk_test_51NEW",
        secretKeyUpdateMode: 2,
        tenantId: "TENANT001",
        webhookSecret: "whsec_NEW",
        webhookSecretUpdateMode: 2,
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:payment-settings"
    );
  });

  it("sends an empty secret as unchanged and can still enable an already registered one", async () => {
    mockUpdateTenantPaymentSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedPaymentSettings,
    });

    const { updateTenantPaymentSettingsAction } = await import("./actions");

    const result = await updateTenantPaymentSettingsAction(
      null,
      textFormData({
        enabled: "on",
        secret_key_configured: "1",
        tenant_id: "TENANT001",
        webhook_secret_configured: "1",
      })
    );

    expect(result?.ok).toBe(true);
    expect(mockUpdateTenantPaymentSettings).toHaveBeenCalledWith(
      {
        enabled: true,
        secretKey: "",
        secretKeyUpdateMode: 1,
        tenantId: "TENANT001",
        webhookSecret: "",
        webhookSecretUpdateMode: 1,
      },
      "en"
    );
  });

  it("returns a field error and skips the API when enabling without any configuration", async () => {
    const { updateTenantPaymentSettingsAction } = await import("./actions");

    const result = await updateTenantPaymentSettingsAction(
      null,
      textFormData({
        enabled: "on",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      fieldErrors: {
        secretKey: "Enter the secret key.",
        webhookSecret: "Enter the webhook signing secret.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantPaymentSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("does not save when the tenant id is missing", async () => {
    const { updateTenantPaymentSettingsAction } = await import("./actions");

    const result = await updateTenantPaymentSettingsAction(
      null,
      textFormData({})
    );

    expect(result).toEqual({
      fieldErrors: {
        tenantId: "The tenant ID is missing.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantPaymentSettings).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantPaymentSettings.mockResolvedValueOnce({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });

    const { updateTenantPaymentSettingsAction } = await import("./actions");

    const result = await updateTenantPaymentSettingsAction(
      null,
      textFormData({
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateTenantPurchaseSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  const storedPurchaseSettings = {
    appStoreUrl: "https://apps.apple.com/app/id123",
    googlePlayUrl: "",
    purchaseAvailability: "app",
  } as const;

  it("saves the default and the store addresses, then revalidates the cache tag", async () => {
    mockUpdateTenantPurchaseSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedPurchaseSettings,
    });

    const { updateTenantPurchaseSettingsAction } = await import("./actions");
    const result = await updateTenantPurchaseSettingsAction(
      null,
      textFormData({
        app_store_url: " https://apps.apple.com/app/id123 ",
        google_play_url: "",
        purchase_availability: "app",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "Where episodes are sold was saved.",
      ok: true,
      settings: storedPurchaseSettings,
    });
    expect(mockUpdateTenantPurchaseSettings).toHaveBeenCalledWith(
      {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: "app",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:purchase-settings"
    );
  });

  // The addresses are links the storefront hands a reader, so they are
  // checked before they are saved rather than left to the API alone.
  it("returns a field error for each address that is not an https:// URL and skips the API", async () => {
    const { updateTenantPurchaseSettingsAction } = await import("./actions");
    const result = await updateTenantPurchaseSettingsAction(
      null,
      textFormData({
        // Assembled, because lint refuses the insecure literal outright.
        app_store_url: `${"http"}://apps.apple.com/app/id123`,
        google_play_url: "play.google.com/store/apps/details?id=a.b",
        purchase_availability: "all",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      fieldErrors: {
        appStoreUrl:
          "Enter the App Store address as an https:// URL, or leave it empty.",
        googlePlayUrl:
          "Enter the Google Play address as an https:// URL, or leave it empty.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantPurchaseSettings).not.toHaveBeenCalled();
  });

  // Following a level above is what a series or an episode does; the tenant
  // has nothing above it, so it has to name one of the three.
  it("refuses a default that names no surface", async () => {
    const { updateTenantPurchaseSettingsAction } = await import("./actions");
    const result = await updateTenantPurchaseSettingsAction(
      null,
      textFormData({
        app_store_url: "",
        google_play_url: "",
        purchase_availability: "",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      fieldErrors: {
        purchaseAvailability: "Choose where episodes are sold.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantPurchaseSettings).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantPurchaseSettings.mockResolvedValueOnce({
      message:
        "Could not save where episodes are sold. Please try again later.",
      ok: false,
    });

    const { updateTenantPurchaseSettingsAction } = await import("./actions");
    const result = await updateTenantPurchaseSettingsAction(
      null,
      textFormData({
        app_store_url: "",
        google_play_url: "",
        purchase_availability: "web",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message:
        "Could not save where episodes are sold. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
