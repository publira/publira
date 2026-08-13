import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTenantDisplayTimeZone, getTenantSiteInfo } from "./tenant";

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
  copyrightText: "© Example",
  siteDescription: "",
  siteTagline: "",
  tenantDomain: "example.test",
  tenantName: "テナント",
  tenantPublicId: "TENANT_PUBLIC",
  theme: undefined,
  timezone: "America/Los_Angeles",
};

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
});
