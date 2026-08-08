import { describe, expect, it, vi } from "vitest";

const { mockResolveTenantId } = vi.hoisted(() => ({
  mockResolveTenantId: vi.fn(),
}));

vi.mock("./lib/tenant", () => ({
  resolveTenantId: mockResolveTenantId,
}));

describe("web-admin proxy", () => {
  it("未登録ドメインは 404 を返す", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveTenantId.mockResolvedValueOnce(null);

    const response = await proxy(
      new NextRequest("https://admin.unknown.example/series")
    );

    expect(response.status).toBe(404);
  });

  it("保護ルートでセッションがない場合はログインへ redirect する", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveTenantId.mockResolvedValueOnce("tenant_001");

    const response = await proxy(
      new NextRequest("https://admin.example.com/series?draft=1")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://admin.example.com/login?next=%2Fseries%3Fdraft%3D1"
    );
  });

  it.each([
    "/forgot-password",
    "/confirm-password?token=test-token",
    "/confirm-email?token=test-token",
  ])("公開ルート %s は未認証でも到達できる", async (path) => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveTenantId.mockResolvedValueOnce("tenant_001");

    const response = await proxy(
      new NextRequest(`https://admin.example.com${path}`)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/tenant_001"
    );
  });

  it.each(["/livez", "/readyz"])(
    "ヘルス probe %s はテナント解決なしで next する",
    async (path) => {
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("./proxy");

      const response = await proxy(
        new NextRequest(`https://admin.example.com${path}`)
      );

      expect(response.status).toBe(200);
      expect(mockResolveTenantId).not.toHaveBeenCalled();
    }
  );
});
