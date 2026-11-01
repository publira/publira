import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantCreatorPageSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCreatorPageSettingsApi: vi.fn(),
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
      getTenantCreatorPageSettings: mockGetTenantCreatorPageSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-creator-page-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the saved switches of the tenant on a successful fetch", async () => {
    mockGetTenantCreatorPageSettingsApi.mockResolvedValueOnce({
      creatorPagesEnabled: true,
      creatorPagesShowSales: false,
    });

    const { getTenantCreatorPageSettings } =
      await import("./tenant-creator-page-settings");

    const result = await getTenantCreatorPageSettings("TENANT001", "en");

    expect(result).toEqual({
      creatorPagesEnabled: true,
      creatorPagesShowSales: false,
      ok: true,
    });
    expect(mockGetTenantCreatorPageSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:creator-page-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantCreatorPageSettings } =
      await import("./tenant-creator-page-settings");

    const result = await getTenantCreatorPageSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantCreatorPageSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming saved switches and drops the cache entry", async () => {
    mockGetTenantCreatorPageSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantCreatorPageSettings } =
      await import("./tenant-creator-page-settings");

    const result = await getTenantCreatorPageSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("creatorPagesEnabled");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantCreatorPageSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantCreatorPageSettings } =
      await import("./tenant-creator-page-settings");

    await expect(
      getTenantCreatorPageSettings("TENANT001", "en")
    ).rejects.toThrow(Error);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
