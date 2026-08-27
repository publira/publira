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

  it("Cookie が無い会員ページはログインへ送る", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/ja/settings")
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/ja/login");
    // `returnTo` は locale を落とした形で持ち回る。
    expect(location.searchParams.get("returnTo")).toBe("/settings");
  });

  it("ログインへの送出はリーダーの locale を保つ", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/en/settings")
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/en/login");
    expect(location.searchParams.get("returnTo")).toBe("/settings");
  });

  it("復号できない Cookie は会員ページからの送出時に削除する", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/ja/settings", "not-a-session")
    );

    expect(response.headers.get("location")).toContain("/ja/login");
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("有効なセッションで /login を開いたら会員ページへ戻す", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/ja/login", cookie)
    );

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/ja/my"
    );
  });

  /**
   * The loop this guards against: a session revoked elsewhere still decrypts and
   * has not reached its local expiry, so without the marker the proxy would read
   * it as active, bounce `/login` back to `/my`, and `/my` would redirect to
   * `/login` again — forever (#603 acceptance criteria).
   */
  it("失効由来の /login は弾き返さず、Cookie を削除して表示する", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request(
        "https://shop.example.com/ja/login?returnTo=%2Fmy&reason=session_revoked",
        cookie
      )
    );

    expect(response.headers.get("location")).toBeNull();
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("失効マーカーは会員ページでは効かない", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().add({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request(
        "https://shop.example.com/ja/settings?reason=session_revoked",
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

  it("locale 付きのパスをテナントと locale の下へ rewrite する", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/en/series/SR01")
    );

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/en/series/SR01`
    );
  });

  it("個別ページの slug は locale の下で /page へ載る", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/ja/privacy")
    );

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/${TENANT_ID}/ja/page/privacy`
    );
  });

  it("locale の無い旧 URL はテナントの既定 locale へリダイレクトする", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/series"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/ja/series"
    );
  });

  // 既定ロケールはこのアプリの定数ではなくテナントの設定なので、`en` の
  // テナントに来た locale 無しの URL が `/ja` へ落ちてはいけない。
  it("既定 locale が en のテナントでは /en へ送る", async () => {
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/series"));

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/en/series"
    );
  });

  it("既定 locale が en のテナントではトップも /en へ送る", async () => {
    mockResolveTenant.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/"));

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/en"
    );
  });

  // locale を名指しした URL は読者の選択なので、既定ロケールで引き戻さない。
  it("既定 locale が en でも /ja の URL はそのまま配信する", async () => {
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

  it("theme.css と通常の Route Handler は locale を挟まない", async () => {
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
  it("再検証パスを proxy matcher から除外する", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/revalidate/" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/revalidate-other" })
    ).toBe(true);
  });
});
