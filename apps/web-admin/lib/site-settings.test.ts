import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockGetTenantConfigApi } = vi.hoisted(
  () => ({
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetTenantConfigApi: vi.fn(),
  })
);

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    auth: {
      getTenantConfig: mockGetTenantConfigApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("getTenantSiteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the settings the tenant config answered with", async () => {
    mockGetTenantConfigApi.mockResolvedValueOnce({
      copyrightText: "© Example",
      siteDescription: "A description",
      siteTagline: "A tagline",
    });

    const { getTenantSiteSettings } = await import("./site-settings");

    const result = await getTenantSiteSettings("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      settings: {
        copyrightText: "© Example",
        siteDescription: "A description",
        siteTagline: "A tagline",
      },
    });
  });

  it("files the settings under the tenant site settings tag", async () => {
    mockGetTenantConfigApi.mockResolvedValueOnce({});

    const { getTenantSiteSettings, tenantSiteSettingsCacheTag } =
      await import("./site-settings");

    await getTenantSiteSettings("TENANT001", "en");

    expect(mockCacheTag).toHaveBeenCalledWith(
      tenantSiteSettingsCacheTag("TENANT001")
    );
  });

  it("tenantSiteSettingsCacheTag normalizes the tenant id", async () => {
    const { tenantSiteSettingsCacheTag } = await import("./site-settings");

    expect(tenantSiteSettingsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:site-settings"
    );
  });
});
