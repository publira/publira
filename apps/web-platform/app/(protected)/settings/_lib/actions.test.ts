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
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("saves a valid IANA name and updates cache tags", async () => {
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
      message: "Default time zone saved.",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultTimezone).toHaveBeenCalledWith(
      "America/Los_Angeles",
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:settings");
  });

  it("saves unlisted aliases accepted by the server", async () => {
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
      message: "Default time zone saved.",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultTimezone).toHaveBeenCalledWith(
      "Asia/Calcutta",
      "en"
    );
  });

  it("rejects invalid time zones without a round trip", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Asia/Nowhere")
    );

    expect(result).toEqual({
      message: "Select a valid time zone.",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects offset notation because the server does not accept it", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("+09:00")
    );

    expect(result).toEqual({
      message: "Select a valid time zone.",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
  });

  it("asks the user to make a selection when none is selected", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("")
    );

    expect(result).toEqual({
      message: "Select a time zone.",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
  });

  it("words the success message in the console locale, so locale=ja is Japanese", async () => {
    mockGetPlatformLocale.mockResolvedValue("ja");
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
      message: "既定タイムゾーンを保存しました。",
      ok: true,
    });
  });

  it("does not update cache tags when saving fails", async () => {
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
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("saves a supported locale and updates cache tags", async () => {
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
      message: "Default language saved.",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultLocale).toHaveBeenCalledWith("en", "en");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:settings");
  });

  it.each(["fr", "ja-JP", ""])(
    "rejects the unsupported %s without a round trip",
    async (defaultLocale) => {
      const { updatePlatformDefaultLocaleAction } = await import("./actions");

      const result = await updatePlatformDefaultLocaleAction(
        null,
        localeFormData(defaultLocale)
      );

      expect(result).toEqual({
        message: "Select a language.",
        ok: false,
      });
      expect(mockUpdatePlatformDefaultLocale).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("does not update cache tags when saving fails", async () => {
    mockUpdatePlatformDefaultLocale.mockResolvedValueOnce({
      message: "Could not save the default language. Please try again later.",
      ok: false,
    });

    const { updatePlatformDefaultLocaleAction } = await import("./actions");

    const result = await updatePlatformDefaultLocaleAction(
      null,
      localeFormData("en")
    );

    expect(result).toEqual({
      message: "Could not save the default language. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
