import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveSetupState } = vi.hoisted(() => ({
  mockResolveSetupState: vi.fn(),
}));

beforeEach(() => {
  mockResolveSetupState.mockReset();
  mockResolveSetupState.mockResolvedValue({
    completed: true,
    defaultLocale: "ja",
  });
});

vi.mock("./lib/setup", () => ({
  resolveSetupState: mockResolveSetupState,
}));

const RESOLVED_LOCALE_COOKIE = "publira_resolved_locale";

const resolvedLocaleCookie = (response: {
  headers: Headers;
}): string | undefined =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${RESOLVED_LOCALE_COOKIE}=`));

describe("web-platform proxy", () => {
  it("returns 404 for GET /logout without setup checks or session operations", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/logout", {
        headers: { cookie: "publira_web_platform_auth=tok" },
      })
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockResolveSetupState).not.toHaveBeenCalled();
  });

  it("returns 404 for unauthenticated GET /logout without redirecting to login", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/logout")
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(mockResolveSetupState).not.toHaveBeenCalled();
  });

  /**
   * `<html lang>` and the client error boundary have no way to reach the saved
   * platform default on their own: the root layout cannot read it without
   * costing every route its static shell, and the boundary renders when the
   * platform API is already unreachable. The proxy reads that value anyway to
   * route the request, so it publishes it here.
   */
  it("publishes the saved default locale to the browser", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/login")
    );

    expect(resolvedLocaleCookie(response)).toContain(
      `${RESOLVED_LOCALE_COOKIE}=ja`
    );
    // The `<head>` script and the error boundary read it from `document.cookie`.
    expect(resolvedLocaleCookie(response)).not.toContain("HttpOnly");
    expect(resolvedLocaleCookie(response)).toContain("Path=/");
  });

  it("republishes the saved default locale once it changes", async () => {
    mockResolveSetupState.mockResolvedValue({
      completed: true,
      defaultLocale: "en",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/login", {
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
      new NextRequest("https://platform.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(resolvedLocaleCookie(response)).toBeUndefined();
  });

  /**
   * Before setup there is nothing saved to publish, and the setup screen
   * negotiates its own language from `Accept-Language`. A cookie
   * written here would turn that negotiation into a stored answer.
   */
  it("publishes nothing while the platform has saved no language", async () => {
    mockResolveSetupState.mockResolvedValue({
      completed: false,
      defaultLocale: "none",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/login")
    );

    expect(response.headers.get("location")).toContain("/setup");
    expect(resolvedLocaleCookie(response)).toBeUndefined();
  });

  /**
   * The platform answered, and what it saved is no longer a language this build
   * renders. Leaving the previous cookie standing would have the document and
   * the error boundary keep naming a language nobody has saved.
   */
  it("expires a cookie the saved default no longer names", async () => {
    mockResolveSetupState.mockResolvedValue({
      completed: true,
      defaultLocale: "none",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(resolvedLocaleCookie(response)).toMatch(/Max-Age=0|Expires=/u);
  });

  /**
   * An outage did not change what the platform saved, and a process that has
   * never had an answer knows nothing about it. Expiring the cookie here would
   * cost the error screen the language an earlier process published — which is
   * the one screen this cookie exists for.
   */
  it("leaves the cookie alone while the saved language is unknown", async () => {
    mockResolveSetupState.mockResolvedValue({
      completed: true,
      defaultLocale: "unknown",
    });
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/login", {
        headers: { cookie: `${RESOLVED_LOCALE_COOKIE}=ja` },
      })
    );

    expect(resolvedLocaleCookie(response)).toBeUndefined();
  });

  it("keeps the health probes off the platform read", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/livez")
    );

    expect(resolvedLocaleCookie(response)).toBeUndefined();
    expect(mockResolveSetupState).not.toHaveBeenCalled();
  });

  it("excludes revalidation paths from the proxy matcher", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate/" })
    ).toBe(false);
  });
});
