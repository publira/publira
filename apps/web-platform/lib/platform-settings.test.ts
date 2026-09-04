import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockCheckSetupStatusApi,
  mockGetPlatformSettingsApi,
  mockHeaders,
  mockResolveAccessToken,
  mockUpdatePlatformSettingsApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockCheckSetupStatusApi: vi.fn(),
  mockGetPlatformSettingsApi: vi.fn(),
  mockHeaders: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdatePlatformSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    settings: {
      getPlatformSettings: mockGetPlatformSettingsApi,
      updatePlatformSettings: mockUpdatePlatformSettingsApi,
    },
    setup: {
      checkSetupStatus: mockCheckSetupStatusApi,
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
    mockHeaders.mockResolvedValue(new Headers());
    mockCheckSetupStatusApi.mockResolvedValue({
      defaultLocale: "ja",
      setupCompleted: true,
    });
  });

  it("returns the default time zone and locale when loading succeeds", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "America/Los_Angeles" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings("en");

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

  it("returns default time zone, locale, and an error when there is no session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings("en");

    expect(result).toEqual({
      defaultTimezone: "Asia/Tokyo",
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetPlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("words the session error in the requested locale, so locale=ja is Japanese", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings("ja");

    expect(result).toEqual({
      defaultTimezone: "Asia/Tokyo",
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
  });

  it("reports a failed read without naming a saved locale", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings("en");

    expect(result.ok).toBe(false);
    expect(result.defaultTimezone).toBe("Asia/Tokyo");
    expect(result).not.toHaveProperty("defaultLocale");
  });

  it("treats a locale this build does not serve as a failed read", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "fr", defaultTimezone: "Asia/Tokyo" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings("en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("defaultLocale");
  });

  it("does not fall back to the host time zone when loading the display time zone fails", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformDisplayTimeZone } = await import("./platform-settings");

    expect(await getPlatformDisplayTimeZone()).toBe("Asia/Tokyo");
  });

  it("returns the saved default time zone when updating succeeds", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "Asia/Tokyo" },
    });
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
    });

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris", "en");

    expect(result).toEqual({ defaultTimezone: "Europe/Paris", ok: true });
    // `default_locale` is required now, so a zone-only save reads the stored
    // language back and sends it along. Posting back the value the screen holds
    // would revert a language saved from another session.
    expect(mockUpdatePlatformSettingsApi).toHaveBeenCalledWith(
      { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("saves nothing when the read before a time zone save fails", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris", "en");

    expect(result.ok).toBe(false);
    expect(mockUpdatePlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("returns the server message for invalid_argument during updates", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Asia/Tokyo" },
    });
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "default_timezone must be a valid IANA time zone name",
        Code.InvalidArgument
      )
    );

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Asia/Nowhere", "en");

    expect(result).toEqual({
      message: "default_timezone must be a valid IANA time zone name",
      ok: false,
    });
  });

  it("returns a shared error message when permission is denied", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Asia/Tokyo" },
    });
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform owner required", Code.PermissionDenied)
    );

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris", "en");

    expect(result.ok).toBe(false);
  });
  it("reloads and sends the current time zone when updating the default locale", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Europe/Paris" },
    });
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
    });

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en", "en");

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    // The server's current value is sent rather than the one the screen holds,
    // so a time zone saved in another session is not rolled back.
    expect(mockUpdatePlatformSettingsApi).toHaveBeenCalledWith(
      { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("does not save when reading before a default locale update fails", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en", "en");

    expect(result.ok).toBe(false);
    expect(mockUpdatePlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("returns a shared error message when updating the default locale fails", async () => {
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

    const result = await updatePlatformDefaultLocale("en", "en");

    expect(result).toEqual({
      message: "The submitted values are invalid.",
      ok: false,
    });
  });

  it("does not save the default locale when there is no session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
    });
    expect(mockGetPlatformSettingsApi).not.toHaveBeenCalled();
    expect(mockUpdatePlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("reports the saved default locale as the display locale", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "Europe/Paris" },
    });

    const { getPlatformDisplayLocale } = await import("./platform-settings");

    await expect(getPlatformDisplayLocale()).resolves.toBe("en");
  });

  it("reads the saved default without a session, through the setup status", async () => {
    // The login screen: no session for `GetPlatformSettings`, but the saved
    // language still decides what it renders in.
    mockResolveAccessToken.mockResolvedValue("");
    mockCheckSetupStatusApi.mockResolvedValue({
      defaultLocale: "en",
      setupCompleted: true,
    });
    mockHeaders.mockResolvedValue(
      new Headers({ "accept-language": "ja,en;q=0.9" })
    );

    const { getPlatformDisplayLocale } = await import("./platform-settings");

    await expect(getPlatformDisplayLocale()).resolves.toBe("en");
    expect(mockGetPlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("keeps the saved language through an outage", async () => {
    // The operator is reading an error screen; arriving in another language
    // would make the outage look like a setting they had changed. The signed-in
    // read is what confirmed the language, so an outage after it must not
    // renegotiate one from the browser.
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "ja", defaultTimezone: "Asia/Tokyo" },
    });
    mockHeaders.mockResolvedValue(
      new Headers({ "accept-language": "en-US,en;q=0.9" })
    );

    const { getPlatformDisplayLocale } = await import("./platform-settings");

    await expect(getPlatformDisplayLocale()).resolves.toBe("ja");

    mockResolveAccessToken.mockResolvedValue("");
    mockCheckSetupStatusApi.mockRejectedValue(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    await expect(getPlatformDisplayLocale()).resolves.toBe("ja");
  });

  it("negotiates from Accept-Language only before anything is saved", async () => {
    mockResolveAccessToken.mockResolvedValue("");
    mockCheckSetupStatusApi.mockResolvedValue({
      defaultLocale: "",
      setupCompleted: false,
    });
    mockHeaders.mockResolvedValue(
      new Headers({ "accept-language": "en-US,en;q=0.9" })
    );

    const { getPlatformDisplayLocale } = await import("./platform-settings");

    await expect(getPlatformDisplayLocale()).resolves.toBe("en");
  });
});
