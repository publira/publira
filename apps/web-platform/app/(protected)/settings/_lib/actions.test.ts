import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockResolveAccessToken,
  mockUpdatePlatformDefaultLocale,
  mockUpdatePlatformDefaultTimezone,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdatePlatformDefaultLocale: vi.fn(),
  mockUpdatePlatformDefaultTimezone: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/email-change", () => ({
  requestPlatformEmailChange: vi.fn(),
}));

vi.mock("#lib/email-settings", () => ({
  sendPlatformSmtpTestEmail: vi.fn(),
  updatePlatformEmailSettings: vi.fn(),
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    getPlatformLocale: mockGetPlatformLocale,
  };
});

vi.mock("#lib/platform-settings", () => ({
  platformSettingsCacheTag: "platform:settings",
  updatePlatformDefaultLocale: mockUpdatePlatformDefaultLocale,
  updatePlatformDefaultTimezone: mockUpdatePlatformDefaultTimezone,
}));

const timezoneFormData = (defaultTimezone: string): FormData => {
  const formData = new FormData();
  formData.set("default_timezone", defaultTimezone);
  return formData;
};

const localeFormData = (defaultLocale: string): FormData => {
  const formData = new FormData();
  formData.set("default_locale", defaultLocale);
  return formData;
};

describe("updatePlatformDefaultTimezoneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withPlatformSessionReauth` resolves the session before the mutation
    // runs; without a token every Action under test would redirect to /login.
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("ja");
  });

  it("有効な IANA 名を保存し、キャッシュタグを更新する", async () => {
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      defaultTimezone: "America/Los_Angeles",
      ok: true,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("America/Los_Angeles")
    );

    expect(result).toEqual({
      defaultTimezone: "America/Los_Angeles",
      message: "既定タイムゾーンを保存しました。",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultTimezone).toHaveBeenCalledWith(
      "America/Los_Angeles",
      "ja"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:settings");
  });

  it("列挙されないエイリアスもサーバと同じく保存できる", async () => {
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      defaultTimezone: "Asia/Calcutta",
      ok: true,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Asia/Calcutta")
    );

    expect(result).toEqual({
      defaultTimezone: "Asia/Calcutta",
      message: "既定タイムゾーンを保存しました。",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultTimezone).toHaveBeenCalledWith(
      "Asia/Calcutta",
      "ja"
    );
  });

  it("不正なタイムゾーンは往復せずに拒否する", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Asia/Nowhere")
    );

    expect(result).toEqual({
      message: "有効なタイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("オフセット表記はサーバが受け付けないため拒否する", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("+09:00")
    );

    expect(result).toEqual({
      message: "有効なタイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
  });

  it("未選択の場合は選択を促す", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("")
    );

    expect(result).toEqual({
      message: "タイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
  });

  it("英語ロケールでは英語の成功メッセージを返す", async () => {
    mockGetPlatformLocale.mockResolvedValue("en");
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      defaultTimezone: "Europe/Paris",
      ok: true,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Europe/Paris")
    );

    expect(result).toEqual({
      defaultTimezone: "Europe/Paris",
      message: "Default time zone saved.",
      ok: true,
    });
  });

  it("保存に失敗した場合はキャッシュタグを更新しない", async () => {
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      message: "default_timezone must be a valid IANA time zone name",
      ok: false,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Europe/Paris")
    );

    expect(result).toEqual({
      message: "default_timezone must be a valid IANA time zone name",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updatePlatformDefaultLocaleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("ja");
  });

  it("対応するロケールを保存し、キャッシュタグを更新する", async () => {
    mockUpdatePlatformDefaultLocale.mockResolvedValueOnce({
      defaultLocale: "en",
      ok: true,
    });

    const { updatePlatformDefaultLocaleAction } = await import("./actions");

    const result = await updatePlatformDefaultLocaleAction(
      null,
      localeFormData("en")
    );

    expect(result).toEqual({
      defaultLocale: "en",
      message: "既定言語を保存しました。",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultLocale).toHaveBeenCalledWith("en", "ja");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:settings");
  });

  it.each(["fr", "ja-JP", ""])(
    "対応していない %s は往復せずに拒否する",
    async (defaultLocale) => {
      const { updatePlatformDefaultLocaleAction } = await import("./actions");

      const result = await updatePlatformDefaultLocaleAction(
        null,
        localeFormData(defaultLocale)
      );

      expect(result).toEqual({
        message: "言語を選択してください。",
        ok: false,
      });
      expect(mockUpdatePlatformDefaultLocale).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("保存に失敗した場合はキャッシュタグを更新しない", async () => {
    mockUpdatePlatformDefaultLocale.mockResolvedValueOnce({
      message: "既定言語の保存に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });

    const { updatePlatformDefaultLocaleAction } = await import("./actions");

    const result = await updatePlatformDefaultLocaleAction(
      null,
      localeFormData("en")
    );

    expect(result).toEqual({
      message: "既定言語の保存に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
