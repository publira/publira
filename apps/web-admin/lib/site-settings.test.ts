import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantConfigApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantConfigApi: vi.fn(),
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
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a sign-in without calling the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantSiteSettings } = await import("./site-settings");
    const result = await getTenantSiteSettings("TENANT001", "en");

    expect(mockGetTenantConfigApi).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read as a message", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetTenantConfigApi.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getTenantSiteSettings } = await import("./site-settings");
    const result = await getTenantSiteSettings("TENANT001", "en");

    expect(result).toMatchObject({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
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
