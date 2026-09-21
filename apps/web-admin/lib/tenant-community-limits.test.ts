import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantCommunityLimitSettingsApi,
  mockUpdateTenantCommunityLimitSettingsApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCommunityLimitSettingsApi: vi.fn(),
  mockUpdateTenantCommunityLimitSettingsApi: vi.fn(),
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
      getTenantCommunityLimitSettings: mockGetTenantCommunityLimitSettingsApi,
      updateTenantCommunityLimitSettings:
        mockUpdateTenantCommunityLimitSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const platformDefaults = {
  commentPost: { perDay: 100, perMinute: 5 },
  commentReport: { perDay: 50, perMinute: 3 },
  contactMessagePerAccount: { perDay: 10, perHour: 3 },
  contactMessagePerClient: { perDay: 20, perHour: 5 },
  duplicateCommentWindowMinutes: 10,
  episodeRating: { perDay: 200, perMinute: 10 },
  viewerPreferences: { perDay: 300, perMinute: 20 },
};

describe("findLooserCommunityLimit", () => {
  it("accepts overrides that are stricter than the platform values", async () => {
    const { findLooserCommunityLimit } =
      await import("./tenant-community-limits");

    expect(
      findLooserCommunityLimit(
        {
          commentPost: { perDay: 40, perMinute: 2 },
          duplicateCommentWindowMinutes: 30,
        },
        platformDefaults
      )
    ).toBeUndefined();
  });

  it("names a count above the platform value", async () => {
    const { findLooserCommunityLimit } =
      await import("./tenant-community-limits");

    expect(
      findLooserCommunityLimit(
        { commentPost: { perDay: 400, perMinute: 5 } },
        platformDefaults
      )
    ).toBe("commentPost");
  });

  // The duplicate-comment window runs the other way: a shorter span lets a
  // reader repeat themselves sooner, so shortening it is the loosening.
  it("names a duplicate-comment window shorter than the platform one", async () => {
    const { findLooserCommunityLimit } =
      await import("./tenant-community-limits");

    expect(
      findLooserCommunityLimit(
        { duplicateCommentWindowMinutes: 5 },
        platformDefaults
      )
    ).toBe("duplicateCommentWindowMinutes");
  });

  it("treats an absent override as following the platform value", async () => {
    const { findLooserCommunityLimit } =
      await import("./tenant-community-limits");

    expect(findLooserCommunityLimit({}, platformDefaults)).toBeUndefined();
  });
});

describe("tenant-community-limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("separates the limits the tenant saved from the platform values", async () => {
    mockGetTenantCommunityLimitSettingsApi.mockResolvedValueOnce({
      overrides: { commentPost: { perDay: 40, perMinute: 2 } },
      platformDefaults,
      revision: 7n,
    });

    const { getTenantCommunityLimitSettings } =
      await import("./tenant-community-limits");

    const result = await getTenantCommunityLimitSettings("TENANT001", "en");

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      overrides: {
        commentPost: { perDay: 40, perMinute: 2 },
        commentReport: undefined,
        duplicateCommentWindowMinutes: undefined,
      },
      platformDefaults,
      revision: "7",
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:community-limits"
    );
  });

  it("reports a failed read without naming a limit", async () => {
    mockGetTenantCommunityLimitSettingsApi.mockRejectedValueOnce(
      new ConnectError("limits unavailable", Code.Unavailable)
    );

    const { getTenantCommunityLimitSettings } =
      await import("./tenant-community-limits");

    const result = await getTenantCommunityLimitSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("platformDefaults");
  });

  it("refuses a limit looser than the platform value and names it", async () => {
    mockGetTenantCommunityLimitSettingsApi.mockResolvedValueOnce({
      overrides: {},
      platformDefaults,
      revision: 7n,
    });

    const { updateTenantCommunityLimitSettings } =
      await import("./tenant-community-limits");

    const result = await updateTenantCommunityLimitSettings(
      {
        expectedRevision: 7n,
        overrides: { commentPost: { perDay: 400, perMinute: 5 } },
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Comment posting may not be looser than the platform limit. Enter a value at least as strict as the platform limit shown beside it.",
      ok: false,
    });
    expect(mockUpdateTenantCommunityLimitSettingsApi).not.toHaveBeenCalled();
  });

  it("sends an absent group for each limit that follows the platform value", async () => {
    mockGetTenantCommunityLimitSettingsApi.mockResolvedValueOnce({
      overrides: {},
      platformDefaults,
      revision: 7n,
    });
    mockUpdateTenantCommunityLimitSettingsApi.mockResolvedValueOnce({});

    const { updateTenantCommunityLimitSettings } =
      await import("./tenant-community-limits");

    const result = await updateTenantCommunityLimitSettings(
      {
        expectedRevision: 7n,
        overrides: { commentPost: { perDay: 40, perMinute: 2 } },
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockUpdateTenantCommunityLimitSettingsApi).toHaveBeenCalledWith(
      {
        expectedRevision: 7n,
        overrides: {
          commentPost: { perDay: 40, perMinute: 2 },
          commentReport: undefined,
          contactMessagePerAccount: undefined,
          contactMessagePerClient: undefined,
          duplicateCommentWindowMinutes: undefined,
          episodeRating: undefined,
          viewerPreferences: undefined,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a stale save as a conflict the operator can act on", async () => {
    mockGetTenantCommunityLimitSettingsApi.mockResolvedValueOnce({
      overrides: {},
      platformDefaults,
      revision: 9n,
    });
    mockUpdateTenantCommunityLimitSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "community limit settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    const { updateTenantCommunityLimitSettings } =
      await import("./tenant-community-limits");

    const result = await updateTenantCommunityLimitSettings(
      {
        expectedRevision: 7n,
        overrides: { commentPost: { perDay: 40, perMinute: 2 } },
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

  it("tenantCommunityLimitsCacheTag normalizes the tenant id", async () => {
    const { tenantCommunityLimitsCacheTag } =
      await import("./tenant-community-limits");

    expect(tenantCommunityLimitsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:community-limits"
    );
  });
});
