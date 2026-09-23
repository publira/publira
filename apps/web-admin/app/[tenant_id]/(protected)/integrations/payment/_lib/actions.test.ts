import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantPaymentSettings,
  mockUpdateTenantPurchaseSettings,
  mockUpdateTenantStorePaymentSettings,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantPaymentSettings: vi.fn(),
  mockUpdateTenantPurchaseSettings: vi.fn(),
  mockUpdateTenantStorePaymentSettings: vi.fn(),
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

vi.mock("#lib/store-payment-settings", () => ({
  tenantStorePaymentSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:store-payment-settings`,
  updateTenantStorePaymentSettings: mockUpdateTenantStorePaymentSettings,
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

const APP_STORE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg
-----END PRIVATE KEY-----`;

const storedStoreSettings = {
  appPurchaseRoute: "store",
  appStore: {
    bundleIdentifier: "com.example.reader",
    enabled: true,
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    keyId: "2X9R4HXF34",
    privateKeyConfigured: true,
    privateKeyHint: "••••••••wIBAQQg",
    ready: true,
  },
  googlePlay: {
    enabled: false,
    packageName: "com.example.reader",
    ready: false,
    serviceAccountEmail: "",
    serviceAccountKeyConfigured: false,
    serviceAccountKeyHint: "",
  },
} as const;

const storeFormData = (
  values: Record<string, string>,
  files: Record<string, File> = {}
): FormData => {
  const formData = textFormData({
    app_purchase_route: "external_checkout",
    private_key_configured: "0",
    private_key_mode: "replace",
    service_account_key_configured: "0",
    service_account_key_mode: "replace",
    tenant_id: "TENANT001",
    ...values,
  });
  for (const [name, file] of Object.entries(files)) {
    formData.set(name, file);
  }
  return formData;
};

describe("updateTenantStorePaymentSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("sends the key read from the chosen file, then clears the cache tag", async () => {
    mockUpdateTenantStorePaymentSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedStoreSettings,
    });

    const { updateTenantStorePaymentSettingsAction } =
      await import("./actions");
    const result = await updateTenantStorePaymentSettingsAction(
      null,
      storeFormData(
        {
          app_purchase_route: "store",
          app_store_enabled: "on",
          issuer_id: " 57246542-96fe-1a63-e053-0824d011072a ",
          key_id: "2X9R4HXF34",
          private_key: "ignored when a file is chosen",
        },
        { private_key_file: new File([`${APP_STORE_KEY}\n`], "AuthKey.p8") }
      )
    );

    expect(result).toEqual({
      message: "The in-app purchase settings were saved.",
      ok: true,
      settings: storedStoreSettings,
    });
    expect(mockUpdateTenantStorePaymentSettings).toHaveBeenCalledWith(
      {
        appPurchaseRoute: "store",
        appStore: {
          enabled: true,
          issuerId: "57246542-96fe-1a63-e053-0824d011072a",
          keyId: "2X9R4HXF34",
          privateKey: { mode: 2, value: APP_STORE_KEY },
        },
        googlePlay: {
          enabled: false,
          serviceAccountKey: { mode: 1, value: "" },
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:store-payment-settings"
    );
  });

  it("sends pasted text, keeps a stored key, and clears a removed one", async () => {
    mockUpdateTenantStorePaymentSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedStoreSettings,
    });

    const { updateTenantStorePaymentSettingsAction } =
      await import("./actions");
    await updateTenantStorePaymentSettingsAction(
      null,
      storeFormData({
        google_play_enabled: "on",
        private_key_configured: "1",
        private_key_mode: "clear",
        service_account_key: '{"type":"service_account"}',
      })
    );

    expect(mockUpdateTenantStorePaymentSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        appStore: expect.objectContaining({
          enabled: false,
          privateKey: { mode: 3, value: "" },
        }),
        googlePlay: {
          enabled: true,
          serviceAccountKey: { mode: 2, value: '{"type":"service_account"}' },
        },
      }),
      "en"
    );

    mockUpdateTenantStorePaymentSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedStoreSettings,
    });
    await updateTenantStorePaymentSettingsAction(
      null,
      storeFormData({
        app_store_enabled: "on",
        issuer_id: "57246542-96fe-1a63-e053-0824d011072a",
        key_id: "2X9R4HXF34",
        private_key_configured: "1",
        private_key_mode: "keep",
      })
    );

    expect(mockUpdateTenantStorePaymentSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appStore: expect.objectContaining({
          privateKey: { mode: 1, value: "" },
        }),
      }),
      "en"
    );
  });

  it("asks for every App Store credential and a Google Play key before saving an enabled store", async () => {
    const { updateTenantStorePaymentSettingsAction } =
      await import("./actions");
    const result = await updateTenantStorePaymentSettingsAction(
      null,
      storeFormData({
        app_store_enabled: "on",
        google_play_enabled: "on",
        private_key_configured: "1",
        private_key_mode: "clear",
      })
    );

    expect(result).toEqual({
      fieldErrors: {
        issuerId: "Enter the issuer ID.",
        keyId: "Enter the key ID.",
        privateKey: "Choose or paste the private key.",
        serviceAccountKey: "Choose or paste the service account key.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantStorePaymentSettings).not.toHaveBeenCalled();
  });

  it("refuses a file too large to be a key", async () => {
    const { updateTenantStorePaymentSettingsAction } =
      await import("./actions");
    const result = await updateTenantStorePaymentSettingsAction(
      null,
      storeFormData(
        {},
        {
          service_account_key_file: new File(
            ["x".repeat(64 * 1024 + 1)],
            "key.json"
          ),
        }
      )
    );

    expect(result).toEqual({
      fieldErrors: {
        serviceAccountKey: "This file is too large to be a key file.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantStorePaymentSettings).not.toHaveBeenCalled();
  });

  it("passes on the fields the API refused and leaves the cache tag alone", async () => {
    mockUpdateTenantStorePaymentSettings.mockResolvedValueOnce({
      fieldErrors: {
        appPurchaseRoute:
          "The app can sell through the store only once the App Store or Google Play is ready: turned on, with its key, and with its app named under App links.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });

    const { updateTenantStorePaymentSettingsAction } =
      await import("./actions");
    const result = await updateTenantStorePaymentSettingsAction(
      null,
      storeFormData({ app_purchase_route: "store" })
    );

    expect(result).toEqual({
      fieldErrors: {
        appPurchaseRoute:
          "The app can sell through the store only once the App Store or Google Play is ready: turned on, with its key, and with its app named under App links.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
