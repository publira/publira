import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantByDomain } = vi.hoisted(() => ({
  mockGetTenantByDomain: vi.fn(),
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    auth: {
      getTenantByDomain: mockGetTenantByDomain,
    },
  }),
}));

describe("tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("admin ドメイン候補で tenantPublicId を解決する", async () => {
    mockGetTenantByDomain.mockResolvedValueOnce({
      tenantPublicId: "tenant_admin_001",
    });

    const { resolveTenantPublicId } = await import("./tenant");

    await expect(resolveTenantPublicId(["admin.example.com"])).resolves.toBe(
      "tenant_admin_001"
    );

    expect(mockGetTenantByDomain).toHaveBeenCalledWith({
      domains: ["admin.example.com"],
    });
  });

  it("未登録ドメインでは null を返す", async () => {
    mockGetTenantByDomain.mockRejectedValueOnce(new Error("not found"));

    const { resolveTenantPublicId } = await import("./tenant");

    await expect(
      resolveTenantPublicId(["admin.unknown.example"])
    ).resolves.toBeNull();
  });
});
