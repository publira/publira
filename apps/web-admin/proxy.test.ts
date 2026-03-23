import { describe, expect, it, vi } from "vitest";

const { mockResolveAdminTenantPublicId } = vi.hoisted(() => ({
  mockResolveAdminTenantPublicId: vi.fn(),
}));

vi.mock("./lib/admin-tenant", () => ({
  resolveAdminTenantPublicId: mockResolveAdminTenantPublicId,
}));

describe("web-admin proxy", () => {
  it("未登録ドメインは 404 を返す", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveAdminTenantPublicId.mockResolvedValueOnce(null);

    const response = await proxy(
      new NextRequest("https://admin.unknown.example/series")
    );

    expect(response.status).toBe(404);
  });

  it("保護ルートでセッションがない場合はログインへ redirect する", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveAdminTenantPublicId.mockResolvedValueOnce("tenant_001");

    const response = await proxy(
      new NextRequest("https://admin.example.com/series?draft=1")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://admin.example.com/login?next=%2Fseries%3Fdraft%3D1"
    );
  });
});
