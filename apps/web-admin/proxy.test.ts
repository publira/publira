import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveTenantId } = vi.hoisted(() => ({
  mockResolveTenantId: vi.fn(),
}));

beforeEach(() => {
  mockResolveTenantId.mockReset();
});

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

  it("/notifications はお知らせへリダイレクトせず保護ルートとして扱う", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveTenantId.mockResolvedValueOnce("tenant_001");

    const response = await proxy(
      new NextRequest("https://admin.example.com/notifications?token=abc")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://admin.example.com/login?next=%2Fnotifications%3Ftoken%3Dabc"
    );
    expect(mockResolveTenantId).toHaveBeenCalledOnce();
  });

  it("GET /logout はテナント解決もセッション操作もせず 404 を返す", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/logout", {
        headers: { cookie: "publira_web_admin_auth=tok" },
      })
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockResolveTenantId).not.toHaveBeenCalled();
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

  it("再検証パスを proxy matcher から除外する", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate/" })
    ).toBe(false);
  });
});
