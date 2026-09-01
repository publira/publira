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
  it("returns 404 for an unregistered domain", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveTenantId.mockResolvedValueOnce(null);

    const response = await proxy(
      new NextRequest("https://admin.unknown.example/series")
    );

    expect(response.status).toBe(404);
  });

  it("redirects to the login screen for a protected route with no session", async () => {
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
  ])(
    "the public route %s is reachable without authentication",
    async (path) => {
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
    }
  );

  it("treats /notifications as a protected route instead of redirecting it to the announcements", async () => {
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

  it("returns 404 for GET /logout without resolving the tenant or touching the session", async () => {
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

  it("answers GET /favicon.ico with 404 without resolving the tenant", async () => {
    const { NextRequest } = await import("next/server");
    const { config, proxy } = await import("./proxy");

    // The branch below only runs for a path the matcher covers; excluding
    // `/favicon.ico` again would send it back into the `[tenant_id]` tree.
    expect(unstable_doesMiddlewareMatch({ config, url: "/favicon.ico" })).toBe(
      true
    );

    const response = await proxy(
      new NextRequest("https://admin.example.com/favicon.ico")
    );

    expect(response.status).toBe(404);
    expect(mockResolveTenantId).not.toHaveBeenCalled();
  });

  it.each(["/livez", "/readyz"])(
    "the health probe %s goes next without resolving the tenant",
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

  it("keeps the revalidation path out of the proxy matcher", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate/" })
    ).toBe(false);
  });
});
