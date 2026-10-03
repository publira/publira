import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetPlatformLocale,
  mockGetPlatformSettingsApi,
  mockResolveAccessToken,
  mockUpdatePlatformSettingsApi,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetPlatformSettingsApi: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdatePlatformSettingsApi: vi.fn(),
  mockVerifyPlatformSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./auth-session", () => ({
  verifyPlatformSession: mockVerifyPlatformSession,
}));

vi.mock("./locale", () => ({
  getPlatformLocale: mockGetPlatformLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
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
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

/**
 * `revision` is an int64, so the generated client hands it over as a `bigint`.
 * A save states the revision its read answered, and the write moves the row on
 * to the next one. (`BigInt(...)` rather than `3n`: the app's TypeScript target
 * is ES2017, which has no bigint literal.)
 */
const storedRevision = 3;
const savedRevision = 4;

describe("platform-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("en");
    mockVerifyPlatformSession.mockResolvedValue({
      name: "Admin",
      publicId: "usr_1",
      role: "platform_super_admin",
    });
  });

  it("returns the default time zone and locale when loading succeeds", async () => {
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
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("platform:settings");
    // Refreshed after a minute: `publiractl platform set` writes the row
    // straight to Postgres, which clears no tag here.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValue(
      new Error("NEXT_REDIRECT:/login")
    );

    const { getPlatformDisplayTimeZone, getPlatformSettings } =
      await import("./platform-settings");

    await expect(getPlatformSettings()).rejects.toThrow(/NEXT_REDIRECT/u);
    await expect(getPlatformDisplayTimeZone()).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetPlatformSettingsApi).not.toHaveBeenCalled();
  });

  it("words a failed read in the operator's locale, so ja is Japanese", async () => {
    mockGetPlatformLocale.mockResolvedValue("ja");
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "fr", defaultTimezone: "UTC" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result).toEqual({
      defaultTimezone: "UTC",
      message:
        "プラットフォーム設定の取得に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });
  });

  it("reports a failed read without naming a saved locale", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result.ok).toBe(false);
    expect(result.defaultTimezone).toBe("UTC");
    expect(result).not.toHaveProperty("defaultLocale");
  });

  it("treats a locale this build does not serve as a failed read", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "fr", defaultTimezone: "UTC" },
    });

    const { getPlatformSettings } = await import("./platform-settings");

    const result = await getPlatformSettings();

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("defaultLocale");
  });

  it("does not fall back to the host time zone when loading the display time zone fails", async () => {
    mockGetPlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError("platform api unavailable", Code.Unavailable)
    );

    const { getPlatformDisplayTimeZone } = await import("./platform-settings");

    expect(await getPlatformDisplayTimeZone()).toBe("UTC");
  });

  it("reads the display time zone with the service credential", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: { defaultLocale: "en", defaultTimezone: "Asia/Tokyo" },
    });

    const { getPlatformDisplayTimeZone } = await import("./platform-settings");

    await expect(getPlatformDisplayTimeZone()).resolves.toBe("Asia/Tokyo");
    expect(mockGetPlatformSettingsApi).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("platform:settings");
  });

  it("returns the saved default time zone when updating succeeds", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: {
        defaultLocale: "en",
        defaultTimezone: "UTC",
        revision: BigInt(storedRevision),
      },
    });
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: {
        defaultLocale: "en",
        defaultTimezone: "Europe/Paris",
        revision: BigInt(savedRevision),
      },
    });

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris", "en");

    expect(result).toEqual({ defaultTimezone: "Europe/Paris", ok: true });
    // `default_locale` is required now, so a zone-only save reads the stored
    // language back and sends it along. Posting back the value the screen holds
    // would revert a language saved from another session. The revision that
    // read answered goes with it, so the server refuses the save outright if
    // the language moved on again in between.
    expect(mockUpdatePlatformSettingsApi).toHaveBeenCalledWith(
      {
        defaultLocale: "en",
        defaultTimezone: "Europe/Paris",
        expectedRevision: BigInt(storedRevision),
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("asks for a reload when the server refuses a time zone save as stale", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: {
        defaultLocale: "en",
        defaultTimezone: "UTC",
        revision: BigInt(storedRevision),
      },
    });
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "platform settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    const { updatePlatformDefaultTimezone } =
      await import("./platform-settings");

    const result = await updatePlatformDefaultTimezone("Europe/Paris", "en");

    expect(result).toEqual({
      message:
        "Another session changed the platform settings, so nothing was saved. Reload the screen and try again.",
      ok: false,
    });
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
      settings: {
        defaultLocale: "ja",
        defaultTimezone: "UTC",
        revision: BigInt(storedRevision),
      },
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
      settings: {
        defaultLocale: "ja",
        defaultTimezone: "UTC",
        revision: BigInt(storedRevision),
      },
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
      settings: {
        defaultLocale: "ja",
        defaultTimezone: "Europe/Paris",
        revision: BigInt(storedRevision),
      },
    });
    mockUpdatePlatformSettingsApi.mockResolvedValueOnce({
      settings: {
        defaultLocale: "en",
        defaultTimezone: "Europe/Paris",
        revision: BigInt(savedRevision),
      },
    });

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en", "en");

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    // The server's current value is sent rather than the one the screen holds,
    // so a time zone saved in another session is not rolled back, and the
    // revision it came with lets the server refuse the save if it moved again.
    expect(mockUpdatePlatformSettingsApi).toHaveBeenCalledWith(
      {
        defaultLocale: "en",
        defaultTimezone: "Europe/Paris",
        expectedRevision: BigInt(storedRevision),
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("asks for a reload when the server refuses a default locale save as stale", async () => {
    mockGetPlatformSettingsApi.mockResolvedValueOnce({
      settings: {
        defaultLocale: "ja",
        defaultTimezone: "Europe/Paris",
        revision: BigInt(storedRevision),
      },
    });
    mockUpdatePlatformSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "platform settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    const { updatePlatformDefaultLocale } = await import("./platform-settings");

    const result = await updatePlatformDefaultLocale("en", "en");

    expect(result).toEqual({
      message:
        "Another session changed the platform settings, so nothing was saved. Reload the screen and try again.",
      ok: false,
    });
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
      settings: {
        defaultLocale: "ja",
        defaultTimezone: "UTC",
        revision: BigInt(storedRevision),
      },
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
      message: "The submitted values are invalid. Check them and try again.",
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
});
