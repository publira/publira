import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockDeleteTenantIconApi,
  mockDeleteTenantLogoApi,
  mockGetSessionId,
  mockGetTenantThemeApi,
  mockUploadTenantIconApi,
  mockUploadTenantLogoApi,
  mockUpsertTenantThemeApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockDeleteTenantIconApi: vi.fn(),
  mockDeleteTenantLogoApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockGetTenantThemeApi: vi.fn(),
  mockUploadTenantIconApi: vi.fn(),
  mockUploadTenantLogoApi: vi.fn(),
  mockUpsertTenantThemeApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    theme: {
      deleteTenantIcon: mockDeleteTenantIconApi,
      deleteTenantLogo: mockDeleteTenantLogoApi,
      getTenantTheme: mockGetTenantThemeApi,
      uploadTenantIcon: mockUploadTenantIconApi,
      uploadTenantLogo: mockUploadTenantLogoApi,
      upsertTenantTheme: mockUpsertTenantThemeApi,
    },
  }),
}));

const brandingVariants = [
  {
    contentType: "image/png",
    fileSizeBytes: 1024,
    height: 64,
    label: "original",
    url: "",
    variantType: "icon",
    width: 64,
  },
];

/** The API answer for a stored branding image, with the URL the server built. */
const storedImage = (url: string) => ({
  updatedAt: "2026-08-19T00:00:00.000Z",
  variants: [{ ...brandingVariants[0], url }],
});

const storedImageResponse = (url: string) => ({
  updatedAt: "2026-08-19T00:00:00.000Z",
  variants: [{ ...brandingVariants[0], url }],
});

const fullTheme = {
  accentColor: "#7aae90",
  accentForegroundColor: "#0f2a1f",
  backgroundColor: "#f6f2e9",
  borderColor: "#d7ccba",
  cardColor: "#fffdf8",
  cardForegroundColor: "#1e2b38",
  destructiveColor: "#b54444",
  destructiveForegroundColor: "#fff4f4",
  foregroundColor: "#1e2b38",
  infoColor: "#3c78c2",
  infoForegroundColor: "#f3f8ff",
  inputColor: "#e3d8c7",
  mutedColor: "#e9e1d3",
  mutedForegroundColor: "#5c6773",
  popoverColor: "#fffdf8",
  popoverForegroundColor: "#1e2b38",
  primaryColor: "#0f7c82",
  primaryForegroundColor: "#f4fbfb",
  ringColor: "#2d8d93",
  secondaryColor: "#d96f4a",
  secondaryForegroundColor: "#fff6f1",
  successColor: "#2f8f5b",
  successForegroundColor: "#f3fcf7",
  surfaceColor: "#fbf8f2",
  surfaceForegroundColor: "#1e2b38",
  warningColor: "#c4872a",
  warningForegroundColor: "#fff8ea",
};

describe("theme-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("テーマ取得に成功した場合は設定を返す", async () => {
    mockGetTenantThemeApi.mockResolvedValueOnce({ theme: fullTheme });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      icon: null,
      logo: null,
      ok: true,
      theme: fullTheme,
    });

    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
    expect(mockGetTenantThemeApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("セッションがない場合はエラーを返す", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantThemeApi).not.toHaveBeenCalled();
  });

  it("更新時に invalid_argument エラーをそのまま返す", async () => {
    mockUpsertTenantThemeApi.mockRejectedValueOnce(
      new ConnectError(
        "theme.primary_color must be a hex color",
        Code.InvalidArgument
      )
    );

    const { updateTenantThemeSettings } = await import("./theme-settings");

    const result = await updateTenantThemeSettings({
      ...fullTheme,
      primaryColor: "#bad",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      message: "theme.primary_color must be a hex color",
      ok: false,
    });
  });

  it("更新に成功した場合は保存されたテーマを返す", async () => {
    const updatedTheme = { ...fullTheme, primaryColor: "#1f6570" };
    mockUpsertTenantThemeApi.mockResolvedValueOnce({ theme: updatedTheme });

    const { updateTenantThemeSettings } = await import("./theme-settings");

    const result = await updateTenantThemeSettings({
      ...updatedTheme,
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      icon: null,
      logo: null,
      ok: true,
      theme: updatedTheme,
    });
  });

  it("icon が設定されている場合はそのバリアントも返す", async () => {
    const stored = storedImageResponse("/images/tenants/icon-1");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        iconImageUpdatedAt: stored.updatedAt,
        iconImageVariants: stored.variants,
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      icon: storedImage("/images/tenants/icon-1"),
      logo: null,
      ok: true,
      theme: fullTheme,
    });
  });

  it("icon をアップロードすると保存後のバリアントを返す", async () => {
    const stored = storedImageResponse("/images/tenants/icon-2");
    mockUploadTenantIconApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        iconImageUpdatedAt: stored.updatedAt,
        iconImageVariants: stored.variants,
      },
    });

    const { uploadTenantIcon } = await import("./theme-settings");

    const iconData = new Uint8Array([1, 2, 3]);
    const result = await uploadTenantIcon({
      iconContentType: "image/png",
      iconData,
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      icon: storedImage("/images/tenants/icon-2"),
      ok: true,
    });
    expect(mockUploadTenantIconApi).toHaveBeenCalledWith(
      {
        iconContentType: "image/png",
        iconData,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("icon の削除に成功した場合はバリアントなしを返す", async () => {
    mockDeleteTenantIconApi.mockResolvedValueOnce({ theme: fullTheme });

    const { deleteTenantIcon } = await import("./theme-settings");

    const result = await deleteTenantIcon("TENANT001");

    expect(result).toEqual({ icon: null, ok: true });
    expect(mockDeleteTenantIconApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("icon が拒否されてもサーバの英文はそのまま出さない", async () => {
    mockUploadTenantIconApi.mockRejectedValueOnce(
      new ConnectError(
        "icon image must be at least 32x32",
        Code.InvalidArgument
      )
    );

    const { uploadTenantIcon } = await import("./theme-settings");

    const result = await uploadTenantIcon({
      iconContentType: "image/png",
      iconData: new Uint8Array([1]),
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("icon image must be at least");
    }
  });

  it("ロゴが設定されている場合はそのバリアントも返す", async () => {
    const stored = storedImageResponse("/images/tenants/logo-1");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        logoImageUpdatedAt: stored.updatedAt,
        logoImageVariants: stored.variants,
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      icon: null,
      logo: storedImage("/images/tenants/logo-1"),
      ok: true,
      theme: fullTheme,
    });
  });

  it("ロゴをアップロードすると保存後のバリアントを返す", async () => {
    const stored = storedImageResponse("/images/tenants/logo-2");
    mockUploadTenantLogoApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        logoImageUpdatedAt: stored.updatedAt,
        logoImageVariants: stored.variants,
      },
    });

    const { uploadTenantLogo } = await import("./theme-settings");

    const logoData = new Uint8Array([1, 2, 3]);
    const result = await uploadTenantLogo({
      logoContentType: "image/png",
      logoData,
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      logo: storedImage("/images/tenants/logo-2"),
      ok: true,
    });
    expect(mockUploadTenantLogoApi).toHaveBeenCalledWith(
      {
        logoContentType: "image/png",
        logoData,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("ロゴの削除に成功した場合はバリアントなしを返す", async () => {
    mockDeleteTenantLogoApi.mockResolvedValueOnce({ theme: fullTheme });

    const { deleteTenantLogo } = await import("./theme-settings");

    const result = await deleteTenantLogo("TENANT001");

    expect(result).toEqual({ logo: null, ok: true });
    expect(mockDeleteTenantLogoApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("ロゴが拒否されてもサーバの英文はそのまま出さない", async () => {
    mockUploadTenantLogoApi.mockRejectedValueOnce(
      new ConnectError(
        "logo image must be at least 32x32",
        Code.InvalidArgument
      )
    );

    const { uploadTenantLogo } = await import("./theme-settings");

    const result = await uploadTenantLogo({
      logoContentType: "image/png",
      logoData: new Uint8Array([1]),
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("logo image must be at least");
    }
  });
});
