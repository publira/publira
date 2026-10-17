import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAssociation, mockGetTenantSiteInfo } = vi.hoisted(() => ({
  mockGetAssociation: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    tenant: { getTenantMobileAppAssociation: mockGetAssociation },
  },
}));

vi.mock("#lib/tenant", () => ({
  getTenantSiteInfo: mockGetTenantSiteInfo,
}));

const { GET } = await import("./route");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const get = (tenantId: string) =>
  GET(
    new NextRequest(
      "https://shop.example.test/.well-known/apple-app-site-association"
    ),
    { params: Promise.resolve({ tenant_id: tenantId }) }
  );

describe("GET /.well-known/apple-app-site-association", () => {
  beforeEach(() => {
    mockGetTenantSiteInfo.mockReset();
    mockGetTenantSiteInfo.mockResolvedValue({
      supportedLocales: ["ja", "en"],
    });
    mockGetAssociation.mockReset();
    mockGetAssociation.mockImplementation(
      ({ tenant }: { tenant: { tenantId: string } }) =>
        Promise.resolve(
          tenant.tenantId === TENANT_A
            ? {
                ios: {
                  bundleIdentifier: "com.tenant-a.reader",
                  teamId: "AAAAA11111",
                },
              }
            : {
                android: {
                  applicationId: "com.tenant_b.reader",
                  sha256CertFingerprints: [
                    Array.from({ length: 32 }, () => "0C").join(":"),
                  ],
                },
              }
        )
    );
  });

  it("names the tenant's iOS app as TEAM_ID.BUNDLE_IDENTIFIER as JSON", async () => {
    const response = await get(TENANT_A);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const document = await response.json();
    expect(document.applinks.details).toHaveLength(1);
    expect(document.applinks.details[0].appIDs).toStrictEqual([
      "AAAAA11111.com.tenant-a.reader",
    ]);
    expect(document.applinks.details[0].components).toContainEqual({
      "/": "/series/*",
    });
    expect(document.applinks.details[0].components).toContainEqual({
      "/": "/en/series/*",
    });
    expect(document.applinks.details[0].components).not.toContainEqual({
      "/": "/ko/series/*",
    });
    expect(document.webcredentials).toStrictEqual({
      apps: ["AAAAA11111.com.tenant-a.reader"],
    });
  });

  it("answers 503 while the tenant's languages cannot be read", async () => {
    mockGetTenantSiteInfo.mockResolvedValueOnce(null);

    const response = await get(TENANT_A);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers 404 for a tenant with no iOS app, whatever another tenant has", async () => {
    const response = await get(TENANT_B);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("AAAAA11111");
    expect(mockGetAssociation).toHaveBeenCalledWith({
      tenant: { tenantId: TENANT_B },
    });
  });
});
