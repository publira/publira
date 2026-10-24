import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockGetTenantAnalyticsSettings } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockGetTenantAnalyticsSettings: vi.fn(),
  }));

// The read runs without the Next.js cache runtime here, so the `"use cache"`
// helpers are stubbed rather than exercised.
vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenant: { getTenantAnalyticsSettings: mockGetTenantAnalyticsSettings },
  },
}));

const { getTenantSiteVerification, siteVerificationMetadata } =
  await import("./site-verification");

describe("getTenantSiteVerification", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetTenantAnalyticsSettings.mockReset();
  });

  it("answers the tenant's codes under the analytics settings tag", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
      siteVerification: {
        bingSiteVerification: "0123ABCD",
        googleSiteVerification: "aBc-123",
      },
    });

    await expect(getTenantSiteVerification(" TENANT001 ")).resolves.toEqual({
      bing: "0123ABCD",
      google: "aBc-123",
    });
    expect(mockGetTenantAnalyticsSettings).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT001" },
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:analytics-settings"
    );
  });

  it("answers null for a tenant that has set neither code", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: { ga4MeasurementId: "G-ABC123DEF4" },
    });

    await expect(getTenantSiteVerification("TENANT001")).resolves.toBeNull();
  });

  it("answers null and drops the entry when the read fails", async () => {
    mockGetTenantAnalyticsSettings.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(getTenantSiteVerification("TENANT001")).resolves.toBeNull();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("answers null without asking for a blank tenant", async () => {
    await expect(getTenantSiteVerification("  ")).resolves.toBeNull();
    expect(mockGetTenantAnalyticsSettings).not.toHaveBeenCalled();
  });
});

describe("siteVerificationMetadata", () => {
  it("names both services' tags when both codes are set", () => {
    expect(
      siteVerificationMetadata({ bing: "0123ABCD", google: "aBc-123" })
    ).toEqual({ google: "aBc-123", other: { "msvalidate.01": "0123ABCD" } });
  });

  it("leaves out the tag of a code that is not set", () => {
    expect(siteVerificationMetadata({ bing: "", google: "aBc-123" })).toEqual({
      google: "aBc-123",
    });
    expect(siteVerificationMetadata({ bing: "0123ABCD", google: "" })).toEqual({
      other: { "msvalidate.01": "0123ABCD" },
    });
  });

  it("names no tag for a tenant with no codes", () => {
    expect(siteVerificationMetadata(null)).toBeUndefined();
  });
});
