import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionId, mockGetTenant } = vi.hoisted(() => ({
  mockGetSessionId: vi.fn(),
  mockGetTenant: vi.fn(),
}));

vi.mock("./session", () => ({
  getSessionId: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    auth: {
      getMe: vi.fn(),
      getTenant: mockGetTenant,
    },
  }),
}));

describe("tenant-detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("tenantPublicId と sessionId からテナント詳細を取得する", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        adminDomain: "admin.example.com",
        domain: "example.com",
        name: "青枝出版",
        publicId: "tenant_admin_001",
      },
    });

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      adminDomain: "admin.example.com",
      domain: "example.com",
      name: "青枝出版",
      publicId: "tenant_admin_001",
    });

    expect(mockGetTenant).toHaveBeenCalledWith(
      {
        tenant: { tenantPublicId: "tenant_admin_001" },
      },
      {
        headers: { "Authorization": "Bearer session-token" },
      }
    );
  });

  it("tenant 名が空なら null を返す", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        domain: "example.com",
        name: "",
        publicId: "tenant_admin_001",
      },
    });

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toBeNull();
  });

  it("API エラー時は null を返す", async () => {
    mockGetTenant.mockRejectedValueOnce(new Error("unauthenticated"));

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toBeNull();
  });
});
