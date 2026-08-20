import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteTenantIcon,
  mockDeleteTenantLogo,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantDefaultLocale,
  mockUpdateTenantTimezone,
  mockUploadTenantIcon,
  mockUploadTenantLogo,
} = vi.hoisted(() => ({
  mockDeleteTenantIcon: vi.fn(),
  mockDeleteTenantLogo: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantDefaultLocale: vi.fn(),
  mockUpdateTenantTimezone: vi.fn(),
  mockUploadTenantIcon: vi.fn(),
  mockUploadTenantLogo: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

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

vi.mock("#lib/theme-settings", () => ({
  deleteTenantIcon: mockDeleteTenantIcon,
  deleteTenantLogo: mockDeleteTenantLogo,
  tenantThemeCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:theme-settings`,
  updateTenantThemeSettings: vi.fn(),
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

describe("updateTenantTimezoneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("有効な IANA 名を保存し、キャッシュタグを更新する", async () => {
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
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith({
      tenantId: "TENANT001",
      timezone: "America/Los_Angeles",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:timezone");
  });

  it("列挙されないエイリアスもサーバと同じく保存できる", async () => {
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
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith({
      tenantId: "TENANT001",
      timezone: "Asia/Calcutta",
    });
  });

  it.each([
    { label: "未知の IANA 名", timezone: "Asia/Nowhere" },
    // `Local` は Go の time.LoadLocation では通るが、API プロセス自身のゾーンを
    // 指すためテナント設定にはならない。オフセット表記は逆に Temporal だけが通す。
    { label: "サーバプロセスのゾーンを指す Local", timezone: "Local" },
    { label: "オフセット表記", timezone: "+09:00" },
  ])("$label は API を呼ばずに拒否する", async ({ timezone }) => {
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

  it("未選択のまま送信した場合は選択を促す", async () => {
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

  it("テナント ID がない場合は保存しない", async () => {
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

  it("保存に失敗した場合はメッセージを返し、キャッシュタグを更新しない", async () => {
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

  it("対応ロケールを保存し、キャッシュタグを更新する", async () => {
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
    expect(mockUpdateTenantDefaultLocale).toHaveBeenCalledWith({
      defaultLocale: "en",
      tenantId: "TENANT001",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:default-locale"
    );
  });

  it.each([
    { label: "未知のロケール", locale: "fr" },
    { label: "大文字のコード", locale: "EN" },
    { label: "BCP 47 タグ", locale: "ja-JP" },
    { label: "空文字", locale: "  " },
  ])("$label は API を呼ばずに拒否する", async ({ locale }) => {
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

  it("テナント ID がない場合は保存しない", async () => {
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

  it("保存に失敗した場合はメッセージを返し、キャッシュタグを更新しない", async () => {
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

  it("選択された画像をアップロードし、公開サイトと設定画面のキャッシュを更新する", async () => {
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
    expect(mockUploadTenantIcon).toHaveBeenCalledWith({
      iconContentType: "image/png",
      iconData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      tenantId: "TENANT001",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("削除では画像を送らずに削除 API を呼ぶ", async () => {
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
    expect(mockDeleteTenantIcon).toHaveBeenCalledWith("TENANT001");
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("画像を選ばずにアップロードした場合は API を呼ばない", async () => {
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

  it("上限を超えるファイルは読み込まずに拒否する", async () => {
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

  it("受け付けない MIME type のファイルは拒否する", async () => {
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

  it("アップロードに失敗した場合はキャッシュを更新しない", async () => {
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

  it("選択された画像をアップロードし、公開サイトと設定画面のキャッシュを更新する", async () => {
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
    expect(mockUploadTenantLogo).toHaveBeenCalledWith({
      logoContentType: "image/png",
      logoData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      tenantId: "TENANT001",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("削除では画像を送らずに削除 API を呼ぶ", async () => {
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
    expect(mockDeleteTenantLogo).toHaveBeenCalledWith("TENANT001");
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("画像を選ばずにアップロードした場合は API を呼ばない", async () => {
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

  it("上限を超えるファイルは読み込まずに拒否する", async () => {
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

  it("受け付けない MIME type のファイルは拒否する", async () => {
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

  it("アップロードに失敗した場合はキャッシュを更新しない", async () => {
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
