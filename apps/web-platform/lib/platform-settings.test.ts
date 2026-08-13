import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetPlatformSettingsApi,
  mockResolveAccessToken,
  mockUpdatePlatformSettingsApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetPlatformSettingsApi: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdatePlatformSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    settings: {
      getPlatformSettings: mockGetPlatformSettingsApi,
      updatePlatformSettings: mockUpdatePlatformSettingsApi,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

describe("platform-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("取得に成功した場合は既定タイムゾーンを返す", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultTimezone: "America/Los_Angeles" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result).toEqual({
      defaultTimezone: "America/Los_Angeles",
      ok: true,
    });
    expect(mockGetPlatformSettingsApi).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("platform:settings");
  });

  it("セッションがない場合はデフォルトのタイムゾーンとエラーを返す", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result).toEqual({
      defaultTimezone: "Asia/Tokyo",
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
    expect(mockGetPlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("取得に失敗した場合もフォームが使えるようデフォルトを添えて返す", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result.ok).toBe(false);
    expect(result.defaultTimezone).toBe("Asia/Tokyo");
  });

  it("表示タイムゾーンは取得に失敗してもホストのゾーンに落ちない", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformDisplayTimeZone } = await import("./platform-settings");

    expect(await getPlatformDisplayTimeZone()).toBe("Asia/Tokyo");
  });

  it("更新に成功した場合は保存された既定タイムゾーンを返す", async () => {
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultTimezone: "Europe/Paris" },
    });

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris");

    expect(result).toEqual({ defaultTimezone: "Europe/Paris", ok: true });
    expect(mockUpdatePlatformSettingsApi).toHaveBeenCalledWith(
      { defaultTimezone: "Europe/Paris" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("更新時の invalid_argument はサーバのメッセージをそのまま返す", async () => {
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "default_timezone must be a valid IANA time zone name",
        Code.InvalidArgument
      )
    );

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Asia/Nowhere");

    expect(result).toEqual({
      message: "default_timezone must be a valid IANA time zone name",
      ok: false,
    });
  });

  it("権限がない場合は共通のエラーメッセージを返す", async () => {
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform owner required", Code.PermissionDenied)
    );

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris");

    expect(result.ok).toBe(false);
  });
});
