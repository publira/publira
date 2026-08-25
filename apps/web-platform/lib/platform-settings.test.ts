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

  it("取得に成功した場合は既定タイムゾーンと既定言語を返す", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "America/Los_Angeles" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result).toEqual({
      defaultLocale: "en",
      defaultTimezone: "America/Los_Angeles",
      ok: true,
    });
    expect(mockGetPlatformSettingsApi).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("platform:settings");
  });

  it("セッションがない場合はデフォルトのタイムゾーン・言語とエラーを返す", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result).toEqual({
      defaultLocale: "ja",
      defaultTimezone: "Asia/Tokyo",
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
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
    expect(result.defaultLocale).toBe("ja");
  });

  it("サポート外の既定言語はフォールバックの ja に落とす", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "fr", defaultTimezone: "Asia/Tokyo" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result.defaultLocale).toBe("ja");
  });

  it("表示タイムゾーンは取得に失敗してもホストのゾーンに落ちない", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformDisplayTimeZone } = await import("./platform-settings");

    expect(await getPlatformDisplayTimeZone()).toBe("Asia/Tokyo");
  });

  it("表示言語は取得に失敗しても ja に落ちる", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformDisplayLocale } = await import("./platform-settings");

    expect(await getPlatformDisplayLocale()).toBe("ja");
  });

  it("更新に成功した場合は保存された既定タイムゾーンを返す", async () => {
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Europe/Paris" },
    });

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris");

    expect(result).toEqual({ defaultTimezone: "Europe/Paris", ok: true });
    // `defaultLocale` は presence-aware なので、送らなければサーバ側の既定言語は保たれる。
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
  it("既定言語の更新は現在のタイムゾーンを読み直して一緒に送る", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Europe/Paris" },
    });
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
    });

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en");

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    // 画面が持つ値ではなくサーバの現在値を送るので、別セッションで保存された
    // タイムゾーンを巻き戻さない。
    expect(mockUpdatePlatformSettingsApi).toHaveBeenCalledWith(
      { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("既定言語の更新前の読み取りに失敗した場合は保存しない", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en");

    expect(result.ok).toBe(false);
    expect(mockUpdatePlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("既定言語の更新に失敗した場合は共通のエラーメッセージを返す", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Asia/Tokyo" },
    });
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "default_locale must be a supported locale",
        Code.InvalidArgument
      )
    );

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en");

    expect(result).toEqual({
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("セッションがない場合は既定言語を保存しない", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
    expect(mockGetPlatformSettingsApi).not.toHaveBeenCalled();
    expect(mockUpdatePlatformSettingsApi).not.toHaveBeenCalled();
  });
});
