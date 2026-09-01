import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteTenantIcon,
  mockDeleteTenantLogo,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantDefaultLocale,
  mockUpdateTenantPaymentSettings,
  mockUpdateTenantThemeSettings,
  mockUpdateTenantTimezone,
  mockUploadTenantIcon,
  mockUploadTenantLogo,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteTenantIcon: vi.fn(),
  mockDeleteTenantLogo: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantDefaultLocale: vi.fn(),
  mockUpdateTenantPaymentSettings: vi.fn(),
  mockUpdateTenantThemeSettings: vi.fn(),
  mockUpdateTenantTimezone: vi.fn(),
  mockUploadTenantIcon: vi.fn(),
  mockUploadTenantLogo: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/admin-auth", () => ({
  requestAdminEmailChange: vi.fn(),
}));

vi.mock("#lib/email-settings", () => ({
  sendTenantSmtpTestEmail: vi.fn(),
  updateTenantEmailSettings: vi.fn(),
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/site-settings", () => ({
  updateTenantSiteSettings: vi.fn(),
}));

vi.mock("#lib/tenant-default-locale", () => ({
  tenantDefaultLocaleCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:default-locale`,
  updateTenantDefaultLocale: mockUpdateTenantDefaultLocale,
}));

vi.mock("#lib/tenant-timezone", () => ({
  tenantTimezoneCacheTag: (tenantId: string) => `tenant:${tenantId}:timezone`,
  updateTenantTimezone: mockUpdateTenantTimezone,
}));

vi.mock("#lib/payment-settings", () => ({
  SECRET_UPDATE_MODE_REPLACE: 2,
  SECRET_UPDATE_MODE_UNCHANGED: 1,
  tenantPaymentSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:payment-settings`,
  updateTenantPaymentSettings: mockUpdateTenantPaymentSettings,
}));

vi.mock("#lib/theme-settings", () => ({
  deleteTenantIcon: mockDeleteTenantIcon,
  deleteTenantLogo: mockDeleteTenantLogo,
  tenantThemeCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:theme-settings`,
  updateTenantThemeSettings: mockUpdateTenantThemeSettings,
  uploadTenantIcon: mockUploadTenantIcon,
  uploadTenantLogo: mockUploadTenantLogo,
}));

const textFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

const themeFormData = (colors = DEFAULT_TENANT_THEME_COLORS): FormData =>
  textFormData({
    tenant_id: "TENANT001",
    ...Object.fromEntries(
      Object.entries(colors).map(([key, value]) => [
        key.replaceAll(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`),
        value,
      ])
    ),
  });

describe("updateTenantThemeSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("keeps a low-contrast color pair out of the API and shows the reason on both fields", async () => {
    const { updateTenantThemeSettingsAction } = await import("./actions");

    const result = await updateTenantThemeSettingsAction(
      null,
      themeFormData({
        ...DEFAULT_TENANT_THEME_COLORS,
        primaryForegroundColor: DEFAULT_TENANT_THEME_COLORS.primaryColor,
      })
    );

    const message =
      "プライマリーカラーとプライマリーテキストカラーのコントラスト比は 4.5:1 以上にしてください（現在 1.00:1）。";
    expect(result).toEqual({
      fieldErrors: {
        primaryColor: message,
        primaryForegroundColor: message,
      },
      message:
        "テキストを読みやすくするため、色の組み合わせを確認してください。",
      ok: false,
    });
    expect(mockUpdateTenantThemeSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("saves the default colors", async () => {
    mockUpdateTenantThemeSettings.mockResolvedValueOnce({
      icon: null,
      logo: null,
      ok: true,
      theme: DEFAULT_TENANT_THEME_COLORS,
    });

    const { updateTenantThemeSettingsAction } = await import("./actions");

    const result = await updateTenantThemeSettingsAction(null, themeFormData());

    expect(result).toEqual({
      message: "テーマを保存しました。",
      ok: true,
      theme: DEFAULT_TENANT_THEME_COLORS,
    });
    expect(mockUpdateTenantThemeSettings).toHaveBeenCalledWith(
      {
        ...DEFAULT_TENANT_THEME_COLORS,
        tenantId: "TENANT001",
      },
      "ja"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });
});

describe("updateTenantTimezoneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves a valid IANA name and revalidates the cache tag", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      ok: true,
      timezone: "America/Los_Angeles",
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({
        tenant_id: "TENANT001",
        timezone: "America/Los_Angeles",
      })
    );

    expect(result).toEqual({
      message: "タイムゾーンを保存しました。",
      ok: true,
      timezone: "America/Los_Angeles",
    });
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith(
      {
        tenantId: "TENANT001",
        timezone: "America/Los_Angeles",
      },
      "ja"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:timezone");
  });

  it("saves an alias that is not enumerated just as the server does", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      ok: true,
      timezone: "Asia/Calcutta",
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone: "Asia/Calcutta" })
    );

    expect(result).toEqual({
      message: "タイムゾーンを保存しました。",
      ok: true,
      timezone: "Asia/Calcutta",
    });
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith(
      {
        tenantId: "TENANT001",
        timezone: "Asia/Calcutta",
      },
      "ja"
    );
  });

  it.each([
    { label: "an unknown IANA name", timezone: "Asia/Nowhere" },
    // `Local` は Go の time.LoadLocation では通るが、API プロセス自身のゾーンを
    // 指すためテナント設定にはならない。オフセット表記は逆に Temporal だけが通す。
    {
      label: "Local, which names the zone of the server process",
      timezone: "Local",
    },
    { label: "an offset notation", timezone: "+09:00" },
  ])("rejects $label without calling the API", async ({ timezone }) => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone })
    );

    expect(result).toEqual({
      message: "有効なタイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("asks for a choice when the form is submitted with nothing selected", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone: "  " })
    );

    expect(result).toEqual({
      message: "タイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
  });

  it("does not save when the tenant id is missing", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ timezone: "Asia/Tokyo" })
    );

    expect(result).toEqual({
      message: "テナント ID が見つかりません。",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      message: "権限がありません。",
      ok: false,
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone: "Asia/Tokyo" })
    );

    expect(result).toEqual({ message: "権限がありません。", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateTenantDefaultLocaleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves the supported locale and revalidates the cache tag", async () => {
    mockUpdateTenantDefaultLocale.mockResolvedValueOnce({
      defaultLocale: "en",
      ok: true,
    });

    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({
        default_locale: "en",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      defaultLocale: "en",
      message: "既定言語を保存しました。",
      ok: true,
    });
    expect(mockUpdateTenantDefaultLocale).toHaveBeenCalledWith(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "ja"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:default-locale"
    );
  });

  it.each([
    { label: "an unknown locale", locale: "fr" },
    { label: "an uppercase code", locale: "EN" },
    { label: "a BCP 47 tag", locale: "ja-JP" },
    { label: "an empty string", locale: "  " },
  ])("rejects $label without calling the API", async ({ locale }) => {
    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({ default_locale: locale, tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "言語を選択してください。",
      ok: false,
    });
    expect(mockUpdateTenantDefaultLocale).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("does not save when the tenant id is missing", async () => {
    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({ default_locale: "en" })
    );

    expect(result).toEqual({
      message: "テナント ID が見つかりません。",
      ok: false,
    });
    expect(mockUpdateTenantDefaultLocale).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantDefaultLocale.mockResolvedValueOnce({
      message: "権限がありません。",
      ok: false,
    });

    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({ default_locale: "en", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({ message: "権限がありません。", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

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
      message: "決済設定を保存しました。",
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
      "ja"
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
      "ja"
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
        secretKey: "シークレットキーを入力してください。",
        webhookSecret: "Webhook 署名シークレットを入力してください。",
      },
      message: "入力内容を確認してください。",
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
        tenantId: "テナント ID が見つかりません。",
      },
      message: "入力内容を確認してください。",
      ok: false,
    });
    expect(mockUpdateTenantPaymentSettings).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantPaymentSettings.mockResolvedValueOnce({
      message: "この操作を行う権限がありません。",
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
      message: "この操作を行う権限がありません。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const iconFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  if (file) {
    formData.set("icon", file);
  }
  return formData;
};

const storedImage = (url: string) => ({
  updatedAt: "2026-08-19T00:00:00.000Z",
  variants: [
    {
      contentType: "image/png",
      fileSizeBytes: 1024,
      height: 64,
      label: "original",
      url,
      variantType: "icon",
      width: 64,
    },
  ],
});

const pngFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "icon.png", {
    type: "image/png",
  });

/** Only the reported size matters to the schema, so the bytes stay cheap. */
const oversizedPngFile = () => {
  const file = pngFile();
  Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
  return file;
};

describe("updateTenantIconAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("uploads the chosen image and revalidates the cache of the public site and the settings screen", async () => {
    mockUploadTenantIcon.mockResolvedValueOnce({
      icon: storedImage("/images/tenants/icon-1"),
      ok: true,
    });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      icon: storedImage("/images/tenants/icon-1"),
      message: "アイコンを保存しました。",
      ok: true,
    });
    expect(mockUploadTenantIcon).toHaveBeenCalledWith(
      {
        iconContentType: "image/png",
        iconData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        tenantId: "TENANT001",
      },
      "ja"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("calls the delete API without sending an image on removal", async () => {
    mockDeleteTenantIcon.mockResolvedValueOnce({ icon: null, ok: true });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "delete", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      icon: null,
      message: "アイコンを削除しました。",
      ok: true,
    });
    expect(mockDeleteTenantIcon).toHaveBeenCalledWith("TENANT001", "ja");
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("does not call the API when uploading without choosing an image", async () => {
    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "画像ファイルを選択してください。",
      ok: false,
    });
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit without reading it", async () => {
    const file = oversizedPngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "画像は 10MB 以下にしてください。",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("rejects a file whose MIME type is not accepted", async () => {
    const file = new File([new Uint8Array([1])], "icon.svg", {
      type: "image/svg+xml",
    });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "JPEG / PNG / WebP の画像を選択してください。",
      ok: false,
    });
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the upload fails", async () => {
    mockUploadTenantIcon.mockResolvedValueOnce({
      message: "アイコンのアップロードに失敗しました。",
      ok: false,
    });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "アイコンのアップロードに失敗しました。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const logoFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  if (file) {
    formData.set("logo", file);
  }
  return formData;
};

describe("updateTenantLogoAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("uploads the chosen image and revalidates the cache of the public site and the settings screen", async () => {
    mockUploadTenantLogo.mockResolvedValueOnce({
      logo: storedImage("/images/tenants/logo-1"),
      ok: true,
    });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      logo: storedImage("/images/tenants/logo-1"),
      message: "ロゴを保存しました。",
      ok: true,
    });
    expect(mockUploadTenantLogo).toHaveBeenCalledWith(
      {
        logoContentType: "image/png",
        logoData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        tenantId: "TENANT001",
      },
      "ja"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("calls the delete API without sending an image on removal", async () => {
    mockDeleteTenantLogo.mockResolvedValueOnce({ logo: null, ok: true });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "delete", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      logo: null,
      message: "ロゴを削除しました。",
      ok: true,
    });
    expect(mockDeleteTenantLogo).toHaveBeenCalledWith("TENANT001", "ja");
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("does not call the API when uploading without choosing an image", async () => {
    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "画像ファイルを選択してください。",
      ok: false,
    });
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit without reading it", async () => {
    const file = oversizedPngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "画像は 10MB 以下にしてください。",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("rejects a file whose MIME type is not accepted", async () => {
    const file = new File([new Uint8Array([1])], "logo.svg", {
      type: "image/svg+xml",
    });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "JPEG / PNG / WebP の画像を選択してください。",
      ok: false,
    });
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the upload fails", async () => {
    mockUploadTenantLogo.mockResolvedValueOnce({
      message: "ロゴのアップロードに失敗しました。",
      ok: false,
    });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "ロゴのアップロードに失敗しました。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
