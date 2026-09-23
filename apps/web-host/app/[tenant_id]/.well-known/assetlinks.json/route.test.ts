import { Code, ConnectError } from "@publira/api-client/errors";
import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/static-param-placeholder";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAssociation } = vi.hoisted(() => ({
  mockGetAssociation: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    tenant: { getTenantMobileAppAssociation: mockGetAssociation },
  },
}));

const { GET } = await import("./route");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const FINGERPRINT_A = Array.from({ length: 32 }, () => "AB").join(":");
const FINGERPRINT_B = Array.from({ length: 32 }, () => "0C").join(":");

const get = (tenantId: string) =>
  GET(
    new NextRequest("https://shop.example.test/.well-known/assetlinks.json"),
    {
      params: Promise.resolve({ tenant_id: tenantId }),
    }
  );

describe("GET /.well-known/assetlinks.json", () => {
  beforeEach(() => {
    mockGetAssociation.mockReset();
    mockGetAssociation.mockImplementation(
      ({ tenant }: { tenant: { tenantId: string } }) =>
        Promise.resolve(
          tenant.tenantId === TENANT_A
            ? {
                android: {
                  applicationId: "com.tenant_a.reader",
                  sha256CertFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
                },
              }
            : {
                ios: {
                  bundleIdentifier: "com.tenant-b.reader",
                  teamId: "BBBBB22222",
                },
              }
        )
    );
  });

  it("names the tenant's Android app with every fingerprint as JSON", async () => {
    const response = await get(TENANT_A);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toStrictEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.tenant_a.reader",
          sha256_cert_fingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
      },
    ]);
  });

  it("answers 404 for a tenant with no Android app, whatever another tenant has", async () => {
    const response = await get(TENANT_B);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("com.tenant_a.reader");
    expect(mockGetAssociation).toHaveBeenCalledWith({
      tenant: { tenantId: TENANT_B },
    });
  });

  it("answers 503 when the API cannot be asked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantMobileAppAssociation */
    });
    mockGetAssociation.mockRejectedValueOnce(
      new ConnectError("upstream", Code.Unavailable)
    );

    const response = await get(TENANT_A);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers 404 without asking the API for a segment that is not a tenant", async () => {
    const responses = await Promise.all(
      ["favicon.ico", STATIC_PARAM_PLACEHOLDER, ""].map((segment) =>
        get(segment)
      )
    );

    expect(responses.map((response) => response.status)).toStrictEqual([
      404, 404, 404,
    ]);
    expect(mockGetAssociation).not.toHaveBeenCalled();
  });
});
