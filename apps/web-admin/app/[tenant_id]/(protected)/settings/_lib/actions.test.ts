import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteTenantFavicon,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantTimezone,
  mockUploadTenantFavicon,
} = vi.hoisted(() => ({
  mockDeleteTenantFavicon: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantTimezone: vi.fn(),
  mockUploadTenantFavicon: vi.fn(),
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

vi.mock("#lib/tenant-timezone", () => ({
  tenantTimezoneCacheTag: (tenantId: string) => `tenant:${tenantId}:timezone`,
  updateTenantTimezone: mockUpdateTenantTimezone,
}));

vi.mock("#lib/theme-settings", () => ({
  deleteTenantFavicon: mockDeleteTenantFavicon,
  tenantThemeCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:theme-settings`,
  updateTenantThemeSettings: vi.fn(),
  uploadTenantFavicon: mockUploadTenantFavicon,
}));

const timezoneFormData = (values: Record<string, string>): FormData => {
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
      timezoneFormData({
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
      timezoneFormData({ tenant_id: "TENANT001", timezone: "Asia/Calcutta" })
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
      timezoneFormData({ tenant_id: "TENANT001", timezone })
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
      timezoneFormData({ tenant_id: "TENANT001", timezone: "  " })
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
      timezoneFormData({ timezone: "Asia/Tokyo" })
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
      timezoneFormData({ tenant_id: "TENANT001", timezone: "Asia/Tokyo" })
    );

    expect(result).toEqual({ message: "権限がありません。", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const faviconFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  if (file) {
    formData.set("favicon", file);
  }
  return formData;
};

const pngFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "favicon.png", {
    type: "image/png",
  });

/** Only the reported size matters to the schema, so the bytes stay cheap. */
const oversizedPngFile = () => {
  const file = pngFile();
  Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
  return file;
};

describe("updateTenantFaviconAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("選択された画像をアップロードし、公開サイトと設定画面のキャッシュを更新する", async () => {
    mockUploadTenantFavicon.mockResolvedValueOnce({
      faviconUrl: "/images/tenants/favicon-1",
      ok: true,
    });

    const { updateTenantFaviconAction } = await import("./actions");

    const result = await updateTenantFaviconAction(
      null,
      faviconFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      faviconUrl: "/images/tenants/favicon-1",
      message: "ファビコンを保存しました。",
      ok: true,
    });
    expect(mockUploadTenantFavicon).toHaveBeenCalledWith({
      faviconContentType: "image/png",
      faviconData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      tenantId: "TENANT001",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("削除では画像を送らずに削除 API を呼ぶ", async () => {
    mockDeleteTenantFavicon.mockResolvedValueOnce({
      faviconUrl: "",
      ok: true,
    });

    const { updateTenantFaviconAction } = await import("./actions");

    const result = await updateTenantFaviconAction(
      null,
      faviconFormData({ intent: "delete", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      faviconUrl: "",
      message: "ファビコンを削除しました。",
      ok: true,
    });
    expect(mockDeleteTenantFavicon).toHaveBeenCalledWith("TENANT001");
    expect(mockUploadTenantFavicon).not.toHaveBeenCalled();
  });

  it("画像を選ばずにアップロードした場合は API を呼ばない", async () => {
    const { updateTenantFaviconAction } = await import("./actions");

    const result = await updateTenantFaviconAction(
      null,
      faviconFormData({ intent: "upload", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "画像ファイルを選択してください。",
      ok: false,
    });
    expect(mockUploadTenantFavicon).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("上限を超えるファイルは読み込まずに拒否する", async () => {
    const file = oversizedPngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantFaviconAction } = await import("./actions");

    const result = await updateTenantFaviconAction(
      null,
      faviconFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "画像は 10MB 以下にしてください。",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantFavicon).not.toHaveBeenCalled();
  });

  it("受け付けない MIME type のファイルは拒否する", async () => {
    const file = new File([new Uint8Array([1])], "favicon.svg", {
      type: "image/svg+xml",
    });

    const { updateTenantFaviconAction } = await import("./actions");

    const result = await updateTenantFaviconAction(
      null,
      faviconFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "JPEG / PNG / WebP の画像を選択してください。",
      ok: false,
    });
    expect(mockUploadTenantFavicon).not.toHaveBeenCalled();
  });

  it("アップロードに失敗した場合はキャッシュを更新しない", async () => {
    mockUploadTenantFavicon.mockResolvedValueOnce({
      message: "ファビコンのアップロードに失敗しました。",
      ok: false,
    });

    const { updateTenantFaviconAction } = await import("./actions");

    const result = await updateTenantFaviconAction(
      null,
      faviconFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "ファビコンのアップロードに失敗しました。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
