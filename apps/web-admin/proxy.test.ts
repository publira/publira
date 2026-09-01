import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveTenantRouting } = vi.hoisted(() => ({
  mockResolveTenantRouting: vi.fn(),
}));

beforeEach(() => {
  mockResolveTenantRouting.mockReset();
  mockResolveTenantRouting.mockResolvedValue({
    defaultLocale: "ja",
    tenantId: "tenant_001",
  });
});

vi.mock("./lib/tenant", () => ({
  resolveTenantRouting: mockResolveTenantRouting,
}));

const RESOLVED_LOCALE_COOKIE = "publira_resolved_locale";

const resolvedLocaleCookie = (response: {
  headers: Headers;
}): string | undefined =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${RESOLVED_LOCALE_COOKIE}=`));

describe("web-admin proxy", () => {
  it("returns 404 for an unregistered domain", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    mockResolveTenantRouting.mockResolvedValueOnce({
      defaultLocale: null,
      tenantId: null,
    });

    const response = await proxy(
      new NextRequest("https://admin.unknown.example/series")
    );

    expect(response.status).toBe(404);
  });

  it("redirects to the login screen for a protected route with no session", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

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

    const response = await proxy(
      new NextRequest("https://admin.example.com/notifications?token=abc")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://admin.example.com/login?next=%2Fnotifications%3Ftoken%3Dabc"
    );
    expect(mockResolveTenantRouting).toHaveBeenCalledOnce();
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
    expect(mockResolveTenantRouting).not.toHaveBeenCalled();
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
    expect(mockResolveTenantRouting).not.toHaveBeenCalled();
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
      expect(mockResolveTenantRouting).not.toHaveBeenCalled();
    }
  );

  /**
   * `<html lang>` and the client error boundary have no way to reach the
   * tenant's saved default on their own: the root layout cannot read it without
   * costing every route its static shell, and the boundary renders when the
   * admin API is already unreachable. The proxy reads that value anyway to
   * route the request, so it publishes it here.
   */
  it("publishes the tenant's saved default locale to the browser", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/login")
    );

    expect(resolvedLocaleCookie(response)).toContain(
      `${RESOLVED_LOCALE_COOKIE}=ja`
    );
    // The `<head>` script and the error boundary read it from `document.cookie`.
    expect(resolvedLocaleCookie(response)).not.toContain("HttpOnly");
    expect(resolvedLocaleCookie(response)).toContain("Path=/");
  });

  it("republishes the saved default locale once it changes", async () => {
    mockResolveTenantRouting.mockResolvedValue({
      defaultLocale: "en",
      tenantId: "tenant_001",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(resolvedLocaleCookie(response)).toContain(
      `${RESOLVED_LOCALE_COOKIE}=en`
    );
  });

  it("leaves the cookie alone when it already names the saved default", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(resolvedLocaleCookie(response)).toBeUndefined();
  });

  /**
   * A code this build serves no catalog for is not a language the console can
   * render, and the script would refuse it anyway. Publishing nothing leaves
   * the document naming none, which is the honest state.
   */
  it("publishes nothing for a default locale it cannot resolve", async () => {
    mockResolveTenantRouting.mockResolvedValue({
      defaultLocale: null,
      tenantId: "tenant_001",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/login")
    );

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/tenant_001"
    );
    expect(resolvedLocaleCookie(response)).toBeUndefined();
  });

  /**
   * The tenant answered, and what it saved is no longer a language this build
   * renders. Leaving the previous cookie standing would have the document and
   * the error boundary keep naming a language nobody has saved.
   */
  it("expires a cookie the tenant's saved default no longer names", async () => {
    mockResolveTenantRouting.mockResolvedValue({
      defaultLocale: null,
      tenantId: "tenant_001",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(resolvedLocaleCookie(response)).toMatch(/Max-Age=0|Expires=/u);
  });

  /**
   * A read that failed says nothing about the saved language, and the console
   * answers 503 before any response could carry a cookie either way.
   */
  it("leaves the cookie alone when the tenant read fails", async () => {
    mockResolveTenantRouting.mockRejectedValue(new Error("admin API is down"));
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://admin.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(response.status).toBe(503);
    expect(resolvedLocaleCookie(response)).toBeUndefined();
  });

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
