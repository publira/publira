import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantRetentionSettingsApi,
  mockUpdateTenantRetentionSettingsApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantRetentionSettingsApi: vi.fn(),
  mockUpdateTenantRetentionSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantRetentionSettings: mockGetTenantRetentionSettingsApi,
      updateTenantRetentionSettings: mockUpdateTenantRetentionSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const platformDefaults = {
  contentEventDays: 90,
  dailyRankingSnapshotDays: 90,
  weeklyRankingSnapshotDays: 400,
  withdrawnCommentDays: 180,
};

describe("tenant-retention-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("separates the periods the tenant saved from the platform defaults", async () => {
    mockGetTenantRetentionSettingsApi.mockResolvedValueOnce({
      overrides: { withdrawnCommentDays: 30 },
      platformDefaults,
      revision: 4n,
    });

    const { getTenantRetentionSettings } =
      await import("./tenant-retention-settings");

    const result = await getTenantRetentionSettings("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      overrides: {
        contentEventDays: undefined,
        dailyRankingSnapshotDays: undefined,
        weeklyRankingSnapshotDays: undefined,
        withdrawnCommentDays: 30,
      },
      platformDefaults,
      revision: "4",
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:retention-settings"
    );
  });

  it("reports a missing session without naming a saved period", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantRetentionSettings } =
      await import("./tenant-retention-settings");

    const result = await getTenantRetentionSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantRetentionSettingsApi).not.toHaveBeenCalled();
  });

  it("reports a failed read without naming a saved period", async () => {
    mockGetTenantRetentionSettingsApi.mockRejectedValueOnce(
      new ConnectError("retention unavailable", Code.Unavailable)
    );

    const { getTenantRetentionSettings } =
      await import("./tenant-retention-settings");

    const result = await getTenantRetentionSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("platformDefaults");
  });

  // Every field is written, so a period the screen left following the platform
  // default has to reach the API as an absent field rather than as a number.
  it("sends an absent field for each period that follows the platform default", async () => {
    mockUpdateTenantRetentionSettingsApi.mockResolvedValueOnce({});

    const { updateTenantRetentionSettings } =
      await import("./tenant-retention-settings");

    const result = await updateTenantRetentionSettings(
      {
        expectedRevision: 4n,
        overrides: { withdrawnCommentDays: 30 },
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockUpdateTenantRetentionSettingsApi).toHaveBeenCalledWith(
      {
        expectedRevision: 4n,
        overrides: {
          contentEventDays: undefined,
          dailyRankingSnapshotDays: undefined,
          weeklyRankingSnapshotDays: undefined,
          withdrawnCommentDays: 30,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a stale save as a conflict the operator can act on", async () => {
    mockUpdateTenantRetentionSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "retention settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    const { updateTenantRetentionSettings } =
      await import("./tenant-retention-settings");

    const result = await updateTenantRetentionSettings(
      {
        expectedRevision: 1n,
        overrides: { withdrawnCommentDays: 30 },
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "These settings were changed elsewhere while this page was open. Reload the page and enter the change again.",
      ok: false,
    });
  });

  it("tenantRetentionSettingsCacheTag normalizes the tenant id", async () => {
    const { tenantRetentionSettingsCacheTag } =
      await import("./tenant-retention-settings");

    expect(tenantRetentionSettingsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:retention-settings"
    );
  });
});
