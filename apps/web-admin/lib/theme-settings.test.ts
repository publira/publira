import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionId, mockGetTenantThemeApi, mockUpsertTenantThemeApi } =
  vi.hoisted(() => ({
    mockGetSessionId: vi.fn(),
    mockGetTenantThemeApi: vi.fn(),
    mockUpsertTenantThemeApi: vi.fn(),
  }));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    theme: {
      getTenantTheme: mockGetTenantThemeApi,
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

    expect(result).toEqual({ ok: true, theme: fullTheme });

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

    expect(result).toEqual({ ok: true, theme: updatedTheme });
  });
});
