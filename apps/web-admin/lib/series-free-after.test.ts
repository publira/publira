import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetSeriesFreeAfterSettings,
  mockUpdateSeriesFreeAfterSettings,
  mockVerifyAdminPageSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetSeriesFreeAfterSettings: vi.fn(),
  mockUpdateSeriesFreeAfterSettings: vi.fn(),
  mockVerifyAdminPageSession: vi.fn(() =>
    Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
  ),
}));

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      getSeriesFreeAfterSettings: mockGetSeriesFreeAfterSettings,
      updateSeriesFreeAfterSettings: mockUpdateSeriesFreeAfterSettings,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const SERIES_ID = "018f0e6a-2000-7000-8000-000000000001";

const fieldViolation = (field: string) =>
  new ConnectError("invalid", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("getSeriesFreeAfterSettings", () => {
  it("reads one series' rule with the service credential", async () => {
    mockGetSeriesFreeAfterSettings.mockResolvedValue({
      settings: {
        daysAfterPublication: 14,
        enabled: true,
        excludedLatestCount: 2,
      },
    });

    const { getSeriesFreeAfterSettings } = await import("./series-free-after");
    const result = await getSeriesFreeAfterSettings({ seriesId: SERIES_ID });

    expect(mockGetSeriesFreeAfterSettings).toHaveBeenCalledWith(
      { seriesId: SERIES_ID, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      `series-free-after-TENANT001-${SERIES_ID}`
    );
    // Saved through the Admin API without this app, a rule reaches the form
    // once the entry is a minute old.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toEqual({
      ok: true,
      settings: {
        daysAfterPublication: 14,
        enabled: true,
        excludedLatestCount: 2,
      },
    });
  });

  // The form would open on zero days, which the next save writes or is
  // refused for.
  it("reports a read that carried no rule instead of opening on zeros", async () => {
    mockGetSeriesFreeAfterSettings.mockResolvedValue({});

    const { getSeriesFreeAfterSettings } = await import("./series-free-after");
    const result = await getSeriesFreeAfterSettings({ seriesId: SERIES_ID });

    expect(result).toEqual({
      message:
        "Could not load the free-after settings. Please try again later.",
      ok: false,
    });
  });

  it("reports a failed read instead of throwing out of the cache scope", async () => {
    mockGetSeriesFreeAfterSettings.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { getSeriesFreeAfterSettings } = await import("./series-free-after");
    const result = await getSeriesFreeAfterSettings({ seriesId: SERIES_ID });

    expect(result.ok).toBe(false);
  });
});

describe("updateSeriesFreeAfterSettings", () => {
  const input = {
    daysAfterPublication: 30,
    enabled: false,
    excludedLatestCount: 0,
    seriesId: SERIES_ID,
    tenantId: "TENANT001",
  };

  it("saves the whole rule with the operator's session", async () => {
    mockUpdateSeriesFreeAfterSettings.mockResolvedValue({
      settings: {
        daysAfterPublication: 30,
        enabled: false,
        excludedLatestCount: 0,
      },
    });

    const { updateSeriesFreeAfterSettings } =
      await import("./series-free-after");

    const result = await updateSeriesFreeAfterSettings(input, "en");

    expect(mockUpdateSeriesFreeAfterSettings).toHaveBeenCalledWith(
      {
        seriesId: SERIES_ID,
        settings: {
          daysAfterPublication: 30,
          enabled: false,
          excludedLatestCount: 0,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      settings: {
        daysAfterPublication: 30,
        enabled: false,
        excludedLatestCount: 0,
      },
    });
  });

  it.each([
    [
      "settings.days_after_publication",
      "Enter the days after publication as a whole number from 1 to 3650.",
    ],
    [
      "settings.excluded_latest_count",
      "Enter the number of newest episodes that stay priced as a whole number, 0 or more.",
    ],
  ])("words a refused %s as the form does", async (field, message) => {
    mockUpdateSeriesFreeAfterSettings.mockRejectedValue(fieldViolation(field));

    const { updateSeriesFreeAfterSettings } =
      await import("./series-free-after");

    const result = await updateSeriesFreeAfterSettings(input, "en");

    expect(result).toEqual({ message, ok: false });
  });

  it("does not call the API without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { updateSeriesFreeAfterSettings } =
      await import("./series-free-after");

    const result = await updateSeriesFreeAfterSettings(input, "en");

    expect(mockUpdateSeriesFreeAfterSettings).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
