import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantCommunityLimitSettings,
  mockUpdateTenantRetentionSettings,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantCommunityLimitSettings: vi.fn(),
  mockUpdateTenantRetentionSettings: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/tenant-community-limits", () => ({
  tenantCommunityLimitsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:community-limits`,
  updateTenantCommunityLimitSettings: mockUpdateTenantCommunityLimitSettings,
}));

vi.mock("#lib/tenant-retention-settings", () => ({
  tenantRetentionSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:retention-settings`,
  updateTenantRetentionSettings: mockUpdateTenantRetentionSettings,
}));

const textFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

describe("updateTenantCommunityLimitsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  // A group the screen left on the platform default disables its controls, and
  // a disabled control submits nothing — so an absent field is the tenant
  // clearing that override rather than a form that lost a value.
  it("saves only the groups the form submitted", async () => {
    mockUpdateTenantCommunityLimitSettings.mockResolvedValueOnce({ ok: true });

    const { updateTenantCommunityLimitsAction } = await import("./actions");

    const result = await updateTenantCommunityLimitsAction(
      null,
      textFormData({
        comment_post_per_day: "40",
        comment_post_per_minute: "2",
        revision: "7",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "The community limits were saved.",
      ok: true,
    });
    expect(mockUpdateTenantCommunityLimitSettings).toHaveBeenCalledWith(
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
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:community-limits"
    );
  });

  it("refuses a group that submitted only one of its two values", async () => {
    const { updateTenantCommunityLimitsAction } = await import("./actions");

    const result = await updateTenantCommunityLimitsAction(
      null,
      textFormData({
        comment_post_per_minute: "2",
        revision: "7",
        tenant_id: "TENANT001",
      })
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdateTenantCommunityLimitSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("refuses a daily limit below the burst it is meant to bound", async () => {
    const { updateTenantCommunityLimitsAction } = await import("./actions");

    const result = await updateTenantCommunityLimitsAction(
      null,
      textFormData({
        comment_post_per_day: "1",
        comment_post_per_minute: "2",
        revision: "7",
        tenant_id: "TENANT001",
      })
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdateTenantCommunityLimitSettings).not.toHaveBeenCalled();
  });

  it("keeps a rejected save from clearing the cache tag", async () => {
    mockUpdateTenantCommunityLimitSettings.mockResolvedValueOnce({
      message: "Comment posting may not be looser than the platform limit.",
      ok: false,
    });

    const { updateTenantCommunityLimitsAction } = await import("./actions");

    const result = await updateTenantCommunityLimitsAction(
      null,
      textFormData({
        comment_post_per_day: "400",
        comment_post_per_minute: "50",
        revision: "7",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "Comment posting may not be looser than the platform limit.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateTenantRetentionSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves only the periods the form submitted", async () => {
    mockUpdateTenantRetentionSettings.mockResolvedValueOnce({ ok: true });

    const { updateTenantRetentionSettingsAction } = await import("./actions");

    const result = await updateTenantRetentionSettingsAction(
      null,
      textFormData({
        revision: "0",
        tenant_id: "TENANT001",
        withdrawn_comment_days: "30",
      })
    );

    expect(result).toEqual({
      message: "The retention periods were saved.",
      ok: true,
    });
    expect(mockUpdateTenantRetentionSettings).toHaveBeenCalledWith(
      {
        expectedRevision: 0n,
        overrides: {
          contentEventDays: undefined,
          dailyRankingSnapshotDays: undefined,
          weeklyRankingSnapshotDays: undefined,
          withdrawnCommentDays: 30,
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:retention-settings"
    );
  });

  it("refuses a period outside the range the server accepts", async () => {
    const { updateTenantRetentionSettingsAction } = await import("./actions");

    const result = await updateTenantRetentionSettingsAction(
      null,
      textFormData({
        revision: "0",
        tenant_id: "TENANT001",
        withdrawn_comment_days: "36501",
      })
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdateTenantRetentionSettings).not.toHaveBeenCalled();
  });

  it("refuses a form whose revision is not a number the server can compare", async () => {
    const { updateTenantRetentionSettingsAction } = await import("./actions");

    const result = await updateTenantRetentionSettingsAction(
      null,
      textFormData({
        revision: "",
        tenant_id: "TENANT001",
        withdrawn_comment_days: "30",
      })
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdateTenantRetentionSettings).not.toHaveBeenCalled();
  });
});
