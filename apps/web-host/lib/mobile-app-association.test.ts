import { Code, ConnectError } from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTenantMobileAppAssociation,
  toAppleAppSiteAssociation,
  toAssetLinks,
} from "./mobile-app-association";

const { mockCacheLife, mockCacheTag, mockGetAssociation } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAssociation: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenant: { getTenantMobileAppAssociation: mockGetAssociation },
  },
}));

const FINGERPRINT_A = Array.from({ length: 32 }, () => "AB").join(":");
const FINGERPRINT_B = Array.from({ length: 32 }, () => "0C").join(":");

describe("getTenantMobileAppAssociation", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetAssociation.mockReset();
  });

  it("reads the tenant's apps under a tag of their own", async () => {
    mockGetAssociation.mockResolvedValueOnce({
      android: {
        applicationId: "com.example.reader",
        sha256CertFingerprints: [FINGERPRINT_A],
      },
      ios: undefined,
    });

    await expect(
      getTenantMobileAppAssociation(" TENANT_001 ")
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        android: {
          applicationId: "com.example.reader",
          sha256CertFingerprints: [FINGERPRINT_A],
        },
        ios: undefined,
      },
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT_001:mobile-app-association"
    );
    expect(mockGetAssociation).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT_001" },
    });
  });

  it("reads a tenant the API does not know as having no app", async () => {
    mockGetAssociation.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    await expect(
      getTenantMobileAppAssociation("TENANT_001")
    ).resolves.toStrictEqual({ ok: true, value: {} });
  });

  it("reports an unavailable API as a failure and keeps it out of the cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantMobileAppAssociation */
    });
    mockGetAssociation.mockRejectedValueOnce(
      new ConnectError("upstream", Code.Unavailable)
    );

    const result = await getTenantMobileAppAssociation("TENANT_001");

    expect(result.ok).toBe(false);
    expect(mockCacheLife).toHaveBeenLastCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("toAssetLinks", () => {
  it("names the app with every signing certificate", () => {
    expect(
      toAssetLinks({
        applicationId: "com.example.reader",
        sha256CertFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
      })
    ).toStrictEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.example.reader",
          sha256_cert_fingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
      },
    ]);
  });
});

describe("toAppleAppSiteAssociation", () => {
  const document = toAppleAppSiteAssociation({
    bundleIdentifier: "com.example.reader",
    teamId: "ABCDE12345",
  });
  const [detail] = document.applinks.details;
  const paths = detail?.components.map((component) => component["/"]);

  it("names the app as TEAM_ID.BUNDLE_IDENTIFIER", () => {
    expect(document.applinks.details).toHaveLength(1);
    expect(detail?.appIDs).toStrictEqual(["ABCDE12345.com.example.reader"]);
  });

  it("claims the paths the app opens, bare and under every locale prefix", () => {
    const claimed = [
      "/series/*",
      "/checkout/return",
      "/verify",
      "/reset-password",
      "/confirm-password",
      "/confirm-email",
      "/announcements",
    ];
    expect(paths).toStrictEqual(
      ["", ...getLocales().map((locale) => `/${locale}`)].flatMap((prefix) =>
        claimed.map((path) => `${prefix}${path}`)
      )
    );
    expect(paths).toContain("/en/checkout/return");
    expect(paths).toContain("/zh-Hant/series/*");
  });
});
