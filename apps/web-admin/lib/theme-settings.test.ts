import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionId, mockGetTenantThemeApi, mockUpsertTenantThemeApi } =
  vi.hoisted(() => ({
    mockGetSessionId: vi.fn(),
    mockGetTenantThemeApi: vi.fn(),
    mockUpsertTenantThemeApi: vi.fn(),
  }));

vi.mock("./session", () => ({
  getSessionId: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    theme: {
      getTenantTheme: mockGetTenantThemeApi,
      upsertTenantTheme: mockUpsertTenantThemeApi,
    },
  }),
}));

describe("theme-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("テーマ取得に成功した場合は設定を返す", async () => {
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        accentColor: "#2f8f5b",
        primaryColor: "#2d8d93",
        secondaryColor: "#c4872a",
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      ok: true,
      theme: {
        accentColor: "#2f8f5b",
        primaryColor: "#2d8d93",
        secondaryColor: "#c4872a",
      },
    });

    expect(mockGetTenantThemeApi).toHaveBeenCalledWith(
      { tenant: { tenantPublicId: "TENANT001" } },
      { headers: { "X-Publira-Session-Id": "session-token" } }
    );
  });

  it("セッションがない場合はエラーを返す", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
    expect(mockGetTenantThemeApi).not.toHaveBeenCalled();
  });

  it("更新時に invalid_argument エラーをそのまま返す", async () => {
    mockUpsertTenantThemeApi.mockRejectedValueOnce(
      new Error("invalid_argument: theme.primary_color must be a hex color")
    );

    const { updateTenantThemeSettings } = await import("./theme-settings");

    const result = await updateTenantThemeSettings({
      accentColor: "#2f8f5b",
      primaryColor: "#bad",
      secondaryColor: "#c4872a",
      tenantPublicId: "TENANT001",
    });

    expect(result).toEqual({
      message: "theme.primary_color must be a hex color",
      ok: false,
    });
  });

  it("更新に成功した場合は保存されたテーマを返す", async () => {
    mockUpsertTenantThemeApi.mockResolvedValueOnce({
      theme: {
        accentColor: "#4e7d64",
        primaryColor: "#1f6570",
        secondaryColor: "#a66e22",
      },
    });

    const { updateTenantThemeSettings } = await import("./theme-settings");

    const result = await updateTenantThemeSettings({
      accentColor: "#4e7d64",
      primaryColor: "#1f6570",
      secondaryColor: "#a66e22",
      tenantPublicId: "TENANT001",
    });

    expect(result).toEqual({
      ok: true,
      theme: {
        accentColor: "#4e7d64",
        primaryColor: "#1f6570",
        secondaryColor: "#a66e22",
      },
    });
  });
});
