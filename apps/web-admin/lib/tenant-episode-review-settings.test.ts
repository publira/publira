import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantEpisodeReviewSettingsApi,
  mockUpdateTenantEpisodeReviewSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantEpisodeReviewSettingsApi: vi.fn(),
  mockUpdateTenantEpisodeReviewSettingsApi: vi.fn(),
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
    tenantSettings: {
      getTenantEpisodeReviewSettings: mockGetTenantEpisodeReviewSettingsApi,
      updateTenantEpisodeReviewSettings:
        mockUpdateTenantEpisodeReviewSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-episode-review-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns whether the tenant requires review, under the setting's tag", async () => {
    mockGetTenantEpisodeReviewSettingsApi.mockResolvedValueOnce({
      episodeReviewRequired: true,
    });

    const { getTenantEpisodeReviewSettings } =
      await import("./tenant-episode-review-settings");

    const result = await getTenantEpisodeReviewSettings("TENANT001", "en");

    expect(result).toEqual({ episodeReviewRequired: true, ok: true });
    expect(mockGetTenantEpisodeReviewSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:episode-review-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantEpisodeReviewSettings } =
      await import("./tenant-episode-review-settings");

    const result = await getTenantEpisodeReviewSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantEpisodeReviewSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming a saved choice", async () => {
    mockGetTenantEpisodeReviewSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantEpisodeReviewSettings } =
      await import("./tenant-episode-review-settings");

    const result = await getTenantEpisodeReviewSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("episodeReviewRequired");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantEpisodeReviewSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantEpisodeReviewSettings } =
      await import("./tenant-episode-review-settings");

    await expect(
      getTenantEpisodeReviewSettings("TENANT001", "en")
    ).rejects.toThrow(Error);
  });

  it("saves the choice and answers what the API stored", async () => {
    mockUpdateTenantEpisodeReviewSettingsApi.mockResolvedValueOnce({
      episodeReviewRequired: true,
    });

    const { updateTenantEpisodeReviewSettings } =
      await import("./tenant-episode-review-settings");

    const result = await updateTenantEpisodeReviewSettings(
      { episodeReviewRequired: true, tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ episodeReviewRequired: true, ok: true });
    expect(mockUpdateTenantEpisodeReviewSettingsApi).toHaveBeenCalledWith(
      { episodeReviewRequired: true, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a refused save", async () => {
    mockUpdateTenantEpisodeReviewSettingsApi.mockRejectedValueOnce(
      new ConnectError("denied", Code.PermissionDenied)
    );

    const { updateTenantEpisodeReviewSettings } =
      await import("./tenant-episode-review-settings");

    const result = await updateTenantEpisodeReviewSettings(
      { episodeReviewRequired: false, tenantId: "TENANT001" },
      "en"
    );

    expect(result.ok).toBe(false);
  });
});
