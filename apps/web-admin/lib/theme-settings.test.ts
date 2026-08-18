import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockDeleteTenantFaviconApi,
  mockGetSessionId,
  mockGetTenantThemeApi,
  mockUploadTenantFaviconApi,
  mockUpsertTenantThemeApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockDeleteTenantFaviconApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockGetTenantThemeApi: vi.fn(),
  mockUploadTenantFaviconApi: vi.fn(),
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
      deleteTenantFavicon: mockDeleteTenantFaviconApi,
      getTenantTheme: mockGetTenantThemeApi,
      uploadTenantFavicon: mockUploadTenantFaviconApi,
      upsertTenantTheme: mockUpsertTenantThemeApi,
    },
  }),
}));

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

    expect(result).toEqual({ faviconUrl: "", ok: true, theme: fullTheme });

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
      faviconUrl: "",
      ok: true,
      theme: updatedTheme,
    });
  });

  it("favicon が設定されている場合はその URL も返す", async () => {
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: { ...fullTheme, faviconUrl: "/images/tenants/favicon-1" },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      faviconUrl: "/images/tenants/favicon-1",
      ok: true,
      theme: fullTheme,
    });
  });

  it("favicon をアップロードすると保存後の URL を返す", async () => {
    mockUploadTenantFaviconApi.mockResolvedValueOnce({
      theme: { ...fullTheme, faviconUrl: "/images/tenants/favicon-2" },
    });

    const { uploadTenantFavicon } = await import("./theme-settings");

    const faviconData = new Uint8Array([1, 2, 3]);
    const result = await uploadTenantFavicon({
      faviconContentType: "image/png",
      faviconData,
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      faviconUrl: "/images/tenants/favicon-2",
      ok: true,
    });
    expect(mockUploadTenantFaviconApi).toHaveBeenCalledWith(
      {
        faviconContentType: "image/png",
        faviconData,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("favicon の削除に成功した場合は空の URL を返す", async () => {
    mockDeleteTenantFaviconApi.mockResolvedValueOnce({ theme: fullTheme });

    const { deleteTenantFavicon } = await import("./theme-settings");

    const result = await deleteTenantFavicon("TENANT001");

    expect(result).toEqual({ faviconUrl: "", ok: true });
    expect(mockDeleteTenantFaviconApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("favicon のアップロードが拒否された場合はサーバのメッセージを返す", async () => {
    mockUploadTenantFaviconApi.mockRejectedValueOnce(
      new ConnectError(
        "favicon image must be at least 32x32",
        Code.InvalidArgument
      )
    );

    const { uploadTenantFavicon } = await import("./theme-settings");

    const result = await uploadTenantFavicon({
      faviconContentType: "image/png",
      faviconData: new Uint8Array([1]),
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      message: "favicon image must be at least 32x32",
      ok: false,
    });
  });
});
