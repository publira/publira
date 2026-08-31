import { encryptSessionPayload } from "@publira/web-session";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveTenant } = vi.hoisted(() => ({
  mockResolveTenant: vi.fn(),
}));

vi.mock("./lib/api-client", () => ({
  apiClient: {},
}));

vi.mock("./lib/tenant-resolution", () => ({
  createTenantResolver: () => mockResolveTenant,
}));

const PUBLIRA_AUTH_SECRET = "test-secret-value-that-is-long-enough-000000";
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COOKIE_NAME = "publira_web_host_auth";

const sealedCookie = (expiresAt: string): Promise<string> =>
  encryptSessionPayload(
    { accessToken: "header.payload.signature", expiresAt },
    PUBLIRA_AUTH_SECRET
  );

/**
 * The proxy only reads `nextUrl`, `url`, `headers`, and `cookies.get`, so a
 * `NextRequest` is more machinery than these cases need.
 */
const request = (url: string, cookie?: string): NextRequest => {
  const nextUrl = Object.assign(new URL(url), {
    clone: () => new URL(url),
  });
  return {
    cookies: {
      get: (name: string) =>
        name === COOKIE_NAME && cookie !== undefined
          ? { name, value: cookie }
          : undefined,
    },
    headers: new Headers({ host: new URL(url).host }),
    nextUrl,
    url,
  } as unknown as NextRequest;
};

const deletedCookieNames = (response: { headers: Headers }): string[] =>
  response.headers
    .getSetCookie()
    .filter((value) => /Max-Age=0|Expires=Thu, 01 Jan 1970/u.test(value))
    .map((value) => value.split("=")[0]);

describe("web-host proxy session handling", () => {
  beforeAll(() => {
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "ja",
      tenantId: TENANT_ID,
    });
  });

  it("Member pages without cookies are sent to login", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/settings"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    // `returnTo` は locale を落とした形で持ち回る。
    expect(location.searchParams.get("returnTo")).toBe("/settings");
  });

  it("Sending to login keeps reader locale", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/en/settings")
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/en/login");
    expect(location.searchParams.get("returnTo")).toBe("/settings");
  });

  it("Cookies that cannot be decrypted will be deleted when sent from the member page.", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/settings", "not-a-session")
    );

    expect(response.headers.get("location")).toContain("/login");
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("If you open /login with a valid session, return to member page", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/login", cookie)
    );

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/my"
    );
  });

  /**
   * The loop this guards against: a session revoked elsewhere still decrypts and
   * has not reached its local expiry, so without the marker the proxy would read
   * it as active, bounce `/login` back to `/my`, and `/my` would redirect to
   * `/login` again — forever (#603 acceptance criteria).
   */
  it("Do not bounce /login caused by revocation, delete cookies and display", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request(
        "https://shop.example.com/login?returnTo=%2Fmy&reason=session_revoked",
        cookie
      )
    );

    expect(response.headers.get("location")).toBeNull();
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("Expiration markers do not work on member pages", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request(
        "https://shop.example.com/settings?reason=session_revoked",
        cookie
      )
    );

    expect(response.headers.get("location")).toBeNull();
    expect(deletedCookieNames(response)).toEqual([]);
  });
});

describe("web-host proxy locale routing", () => {
  beforeAll(() => {
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "ja",
      tenantId: TENANT_ID,
    });
  });

  it("Rewrite path with locale under tenant and locale", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/en/series/SR01")
    );

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/en/series/SR01`
    );
  });

  it("Slugs for individual pages are posted to /page under locale", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/en/privacy")
    );

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/en/page/privacy`
    );
  });

  it("Rewrite URL without locale to internal route of tenant's default locale", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/series"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/ja/series`
    );
  });

  // 既定ロケールはこのアプリの定数ではなくテナントの設定なので、`en` の
  // テナントに来た locale 無しの URL が `/ja` へ落ちてはいけない。
  it("For tenants whose default locale is en, rewrite URLs without locale as en.", async () => {
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/series"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/en/series`
    );
  });

  it("Rewrite the top as en even if the default locale is en.", async () => {
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/en`
    );
  });

  it("URLs that specify the default locale are sent to the regular URL with the path and query preserved.", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/ja/series/SR01?source=bookmark")
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/series/SR01");
    expect(location.search).toBe("?source=bookmark");
  });

  it("Send /en to the regular URL even if the default locale is en for tenants", async () => {
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/en/series/SR01?source=bookmark")
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/series/SR01");
    expect(location.search).toBe("?source=bookmark");
  });

  // locale を名指しした URL は読者の選択なので、既定ロケールで引き戻さない。
  it("Even if the default locale is en, /ja URLs are delivered as is.", async () => {
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/ja/series"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/ja/series`
    );
  });

  it("theme.css and normal Route Handler do not include locale", async () => {
    const { proxy } = await import("./proxy");

    const theme = await proxy(request("https://shop.example.com/theme.css"));
    const route = await proxy(
      request("https://shop.example.com/api/v1/webhook/stripe")
    );

    expect(theme.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/theme.css`
    );
    expect(route.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/api/v1/webhook/stripe`
    );
  });
});

describe("web-host proxy internal revalidation", () => {
  it("Exclude revalidation paths from proxy matcher", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate/" })
    ).toBe(false);
  });
});
