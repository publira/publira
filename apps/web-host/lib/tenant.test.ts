import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTenantDefaultLocale,
  getTenantDisplayTimeZone,
  getTenantSiteInfo,
  getTenantTheme,
} from "./tenant";

const { mockCacheLife, mockCacheTag, mockGetTenant } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetTenant: vi.fn(),
}));

// The reads run without the Next.js cache runtime here, so the `"use cache"`
// helpers are stubbed rather than exercised.
vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenant: {
      getTenant: mockGetTenant,
    },
  },
}));

const tenantResponse = {
  acceptsPayments: true,
  copyrightText: "© Example",
  defaultLocale: "en",
  siteDescription: "",
  siteTagline: "",
  tenantDomain: "example.test",
  tenantName: "Example Tenant",
  tenantPublicId: "TENANT_PUBLIC",
  theme: undefined,
  timezone: "America/Los_Angeles",
};

const brandingVariant = (url: string) => ({
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 64,
  label: "original",
  url,
  variantType: "icon",
  width: 64,
});

describe("tenant", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetTenant.mockReset();
  });

  it("Add a dedicated tag to theme reading for theme.css", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: { primaryColor: "#112233" },
    });

    await expect(getTenantTheme(" TENANT_001 ")).resolves.toMatchObject({
      primaryColor: "#112233",
    });

    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT_001:theme");
    expect(mockGetTenant).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT_001" },
    });
  });

  it("Add public API time zone to site information", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(mockGetTenant).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT_001" },
    });
    expect(info?.timeZone).toBe("America/Los_Angeles");
    expect(info?.acceptsPayments).toBe(true);
  });

  it("Treat tenants that cannot accept payments as false", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      acceptsPayments: false,
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.acceptsPayments).toBe(false);
  });

  it("You can get the variant if the tenant icon is set.", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: {
        iconImageUpdatedAt: "2026-08-19T00:00:00.000Z",
        iconImageVariants: [brandingVariant("/images/tenants/icon-1")],
      },
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.iconImageUpdatedAt).toBe("2026-08-19T00:00:00.000Z");
    expect(info?.iconImageVariants).toEqual([
      brandingVariant("/images/tenants/icon-1"),
    ]);
  });

  it("If tenant icon is not set, it does not have a variant.", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.iconImageVariants).toBeUndefined();
  });

  it("Variants can be obtained if the tenant logo is set.", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: {
        logoImageUpdatedAt: "2026-08-19T00:00:00.000Z",
        logoImageVariants: [brandingVariant("/images/tenants/logo-1")],
      },
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.logoImageVariants).toEqual([
      brandingVariant("/images/tenants/logo-1"),
    ]);
  });

  it("If the tenant logo is not set, there will be no variant.", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.logoImageVariants).toBeUndefined();
  });

  it("Fallback to default time zone when field is empty", async () => {
    mockGetTenant.mockResolvedValueOnce({ ...tenantResponse, timezone: "  " });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.timeZone).toBe("Asia/Tokyo");
  });

  it("Return tenant timezone as display timezone", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantDisplayTimeZone("TENANT_001")).resolves.toBe(
      "America/Los_Angeles"
    );
  });

  it("Display in default time zone even when tenant cannot be obtained", async () => {
    // Degrading to the host's zone would make the rendered wall clock depend on
    // where the container runs, which is exactly what the tenant zone removes.
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDisplayTimeZone("TENANT_001")).resolves.toBe(
      "Asia/Tokyo"
    );
  });

  it("Display in default time zone even when tenant ID is empty", async () => {
    await expect(getTenantDisplayTimeZone("  ")).resolves.toBe("Asia/Tokyo");
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("List the default locale of the public API in the site information", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.defaultLocale).toBe("en");
  });

  it("refuses a locale this build serves no catalog for", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      defaultLocale: "fr",
    });

    // The chrome degrades the way any unreadable tenant does; the callers that
    // need a language to render in are the ones that hear about it.
    await expect(getTenantSiteInfo("TENANT_001")).resolves.toBeNull();
  });

  it("Return tenant settings as default locale", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantDefaultLocale("TENANT_001")).resolves.toBe("en");
  });

  it("reports an unreadable tenant instead of naming a locale", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDefaultLocale("TENANT_001")).rejects.toThrow(
      "tenant default locale is unavailable"
    );
  });
});
