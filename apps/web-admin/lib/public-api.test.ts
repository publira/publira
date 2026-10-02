import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockGetTenant } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetTenant: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("@publira/api-client/public/client", () => ({
  createPublicApiClient: () => ({
    tenant: {
      getTenant: mockGetTenant,
    },
  }),
}));

const tenantId = "018f0e6a-1000-7000-8000-000000000001";

describe("getTenantName", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetTenant.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the tenant name from the public API", async () => {
    mockGetTenant.mockResolvedValueOnce({
      defaultLocale: "en",
      tenantName: "  Example Publishing  ",
      theme: undefined,
    });

    const { getTenantName } = await import("./public-api");

    await expect(getTenantName(tenantId)).resolves.toBe("Example Publishing");
    expect(mockGetTenant).toHaveBeenCalledWith({
      tenant: { tenantId },
    });
    expect(mockCacheLife).toHaveBeenCalledWith("hours");
    expect(mockCacheTag).toHaveBeenCalledWith(`tenant:${tenantId}:site`);
  });

  it("returns null when the public API is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantPublicInfo */
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    const { getTenantName } = await import("./public-api");

    await expect(getTenantName(tenantId)).resolves.toBeNull();
  });

  it("returns null when there is no tenant", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("not found", Code.NotFound)
    );

    const { getTenantName } = await import("./public-api");

    await expect(getTenantName(tenantId)).resolves.toBeNull();
  });
});

describe("getTenantDisplayLocale", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetTenant.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the tenant's saved default locale", async () => {
    mockGetTenant.mockResolvedValueOnce({
      defaultLocale: "en",
      tenantName: "Sample Press",
      theme: undefined,
    });

    const { getTenantDisplayLocale } = await import("./public-api");

    await expect(getTenantDisplayLocale(tenantId)).resolves.toBe("en");
  });

  // The console shell resolves this before any boundary exists, so an outage
  // must not change the language and must not stop the page rendering at all.
  it("keeps the last confirmed locale through an outage", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantPublicInfo */
    });
    mockGetTenant.mockResolvedValueOnce({
      defaultLocale: "en",
      tenantName: "Sample Press",
      theme: undefined,
    });

    const { getTenantDisplayLocale } = await import("./public-api");

    await expect(getTenantDisplayLocale(tenantId)).resolves.toBe("en");

    mockGetTenant.mockRejectedValue(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDisplayLocale(tenantId)).resolves.toBe("en");
  });

  it("reports a tenant it has never resolved a locale for", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantPublicInfo */
    });
    mockGetTenant.mockRejectedValue(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    const { getTenantDisplayLocale } = await import("./public-api");

    await expect(
      getTenantDisplayLocale("018f0e6a-1000-7000-8000-00000000ffff")
    ).rejects.toThrow("tenant default locale is unavailable");
  });
});

describe("getTenantPublicInfo", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetTenant.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers the time zone beside the name", async () => {
    mockGetTenant.mockResolvedValueOnce({
      defaultLocale: "en",
      tenantName: "Example Publishing",
      theme: undefined,
      timezone: " America/Los_Angeles ",
    });

    const { getTenantPublicInfo } = await import("./public-api");

    await expect(getTenantPublicInfo(tenantId)).resolves.toMatchObject({
      defaultLocale: "en",
      name: "Example Publishing",
      timezone: "America/Los_Angeles",
    });
    expect(mockCacheTag).toHaveBeenCalledWith(`tenant:${tenantId}:site`);
  });

  it("answers no time zone for a response without one", async () => {
    mockGetTenant.mockResolvedValueOnce({
      defaultLocale: "en",
      tenantName: "Example Publishing",
      theme: undefined,
    });

    const { getTenantPublicInfo } = await import("./public-api");

    await expect(getTenantPublicInfo(tenantId)).resolves.toMatchObject({
      timezone: null,
    });
  });

  it("answers null and drops the entry when the public API is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantPublicInfo */
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    const { getTenantPublicInfo } = await import("./public-api");

    await expect(getTenantPublicInfo(tenantId)).resolves.toBeNull();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("tenantSiteCacheTag", () => {
  it("names the tenant's public read by its trimmed id", async () => {
    const { tenantSiteCacheTag } = await import("./public-api");

    expect(tenantSiteCacheTag(`  ${tenantId} `)).toBe(
      `tenant:${tenantId}:site`
    );
  });
});
