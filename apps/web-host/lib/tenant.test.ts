import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTenantDefaultLocale,
  getTenantDisplayTimeZone,
  getTenantSiteInfo,
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
  tenantName: "テナント",
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
    mockGetTenant.mockReset();
  });

  it("公開 API のタイムゾーンをサイト情報に載せる", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(mockGetTenant).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT_001" },
    });
    expect(info?.timeZone).toBe("America/Los_Angeles");
    expect(info?.acceptsPayments).toBe(true);
  });

  it("決済を受け付けられないテナントを false として扱う", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      acceptsPayments: false,
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.acceptsPayments).toBe(false);
  });

  it("テナント icon が設定されていればバリアントを取得できる", async () => {
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

  it("テナント icon が未設定ならバリアントを持たない", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.iconImageVariants).toBeUndefined();
  });

  it("テナントロゴが設定されていればバリアントを取得できる", async () => {
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

  it("テナントロゴが未設定ならバリアントを持たない", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.logoImageVariants).toBeUndefined();
  });

  it("フィールドが空のときは既定タイムゾーンにフォールバックする", async () => {
    mockGetTenant.mockResolvedValueOnce({ ...tenantResponse, timezone: "  " });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.timeZone).toBe("Asia/Tokyo");
  });

  it("表示タイムゾーンとしてテナントのタイムゾーンを返す", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantDisplayTimeZone("TENANT_001")).resolves.toBe(
      "America/Los_Angeles"
    );
  });

  it("テナントを取得できないときも既定タイムゾーンで表示する", async () => {
    // Degrading to the host's zone would make the rendered wall clock depend on
    // where the container runs, which is the thing #564 removed.
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDisplayTimeZone("TENANT_001")).resolves.toBe(
      "Asia/Tokyo"
    );
  });

  it("テナント ID が空のときも既定タイムゾーンで表示する", async () => {
    await expect(getTenantDisplayTimeZone("  ")).resolves.toBe("Asia/Tokyo");
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("公開 API の既定ロケールをサイト情報に載せる", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.defaultLocale).toBe("en");
  });

  it("このビルドが配信しないロケールだけ ja に落とす", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      defaultLocale: "fr",
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.defaultLocale).toBe("ja");
  });

  it("既定ロケールとしてテナントの設定値を返す", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantDefaultLocale("TENANT_001")).resolves.toBe("en");
  });

  it("テナントを取得できないときも既定ロケールは ja になる", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDefaultLocale("TENANT_001")).resolves.toBe("ja");
  });
});
