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
  mockGetSeriesWaitFreeSettings,
  mockUpdateSeriesWaitFreeSettings,
  mockVerifyAdminPageSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetSeriesWaitFreeSettings: vi.fn(),
  mockUpdateSeriesWaitFreeSettings: vi.fn(),
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
      getSeriesWaitFreeSettings: mockGetSeriesWaitFreeSettings,
      updateSeriesWaitFreeSettings: mockUpdateSeriesWaitFreeSettings,
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

describe("getSeriesWaitFreeSettings", () => {
  it("reads one series' rule with the service credential", async () => {
    mockGetSeriesWaitFreeSettings.mockResolvedValue({
      settings: {
        accessHours: 48,
        enabled: true,
        excludedLatestCount: 2,
        rechargeHours: 24,
      },
    });

    const { getSeriesWaitFreeSettings } = await import("./series-wait-free");
    const result = await getSeriesWaitFreeSettings({ seriesId: SERIES_ID });

    expect(mockGetSeriesWaitFreeSettings).toHaveBeenCalledWith(
      { seriesId: SERIES_ID, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      `series-wait-free-TENANT001-${SERIES_ID}`
    );
    // Saved through the Admin API without this app, a rule reaches the form
    // once the entry is a minute old.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toEqual({
      ok: true,
      settings: {
        accessHours: 48,
        enabled: true,
        excludedLatestCount: 2,
        rechargeHours: 24,
      },
    });
  });

  // The form would open on zero hours, which the next save writes or is
  // refused for.
  it("reports a read that carried no rule instead of opening on zeros", async () => {
    mockGetSeriesWaitFreeSettings.mockResolvedValue({});

    const { getSeriesWaitFreeSettings } = await import("./series-wait-free");
    const result = await getSeriesWaitFreeSettings({ seriesId: SERIES_ID });

    expect(result).toEqual({
      message:
        "Could not load the free-if-you-wait settings. Please try again later.",
      ok: false,
    });
  });

  it("reports a failed read instead of throwing out of the cache scope", async () => {
    mockGetSeriesWaitFreeSettings.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { getSeriesWaitFreeSettings } = await import("./series-wait-free");
    const result = await getSeriesWaitFreeSettings({ seriesId: SERIES_ID });

    expect(result.ok).toBe(false);
  });
});

describe("updateSeriesWaitFreeSettings", () => {
  const input = {
    accessHours: 72,
    enabled: false,
    excludedLatestCount: 0,
    rechargeHours: 23,
    seriesId: SERIES_ID,
    tenantId: "TENANT001",
  };

  it("saves the whole rule with the operator's session", async () => {
    mockUpdateSeriesWaitFreeSettings.mockResolvedValue({
      settings: {
        accessHours: 72,
        enabled: false,
        excludedLatestCount: 0,
        rechargeHours: 23,
      },
    });

    const { updateSeriesWaitFreeSettings } = await import("./series-wait-free");
    const result = await updateSeriesWaitFreeSettings(input, "en");

    expect(mockUpdateSeriesWaitFreeSettings).toHaveBeenCalledWith(
      {
        seriesId: SERIES_ID,
        settings: {
          accessHours: 72,
          enabled: false,
          excludedLatestCount: 0,
          rechargeHours: 23,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      settings: {
        accessHours: 72,
        enabled: false,
        excludedLatestCount: 0,
        rechargeHours: 23,
      },
    });
  });

  it.each([
    [
      "settings.recharge_hours",
      "Enter the hours until the next ticket as a whole number from 1 to 8760.",
    ],
    [
      "settings.access_hours",
      "Enter the hours an episode stays open as a whole number from 1 to 8760.",
    ],
    [
      "settings.excluded_latest_count",
      "Enter the number of newest episodes as a whole number, 0 or more.",
    ],
  ])("words a refused %s as the form does", async (field, message) => {
    mockUpdateSeriesWaitFreeSettings.mockRejectedValue(fieldViolation(field));

    const { updateSeriesWaitFreeSettings } = await import("./series-wait-free");
    const result = await updateSeriesWaitFreeSettings(input, "en");

    expect(result).toEqual({ message, ok: false });
  });

  it("does not call the API without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { updateSeriesWaitFreeSettings } = await import("./series-wait-free");
    const result = await updateSeriesWaitFreeSettings(input, "en");

    expect(mockUpdateSeriesWaitFreeSettings).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
