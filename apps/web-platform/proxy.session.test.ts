import { encryptSessionPayload } from "@publira/web-session";
import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsSetupCompleted } = vi.hoisted(() => ({
  mockIsSetupCompleted: vi.fn(),
}));

vi.mock("./lib/setup", () => ({
  isSetupCompleted: mockIsSetupCompleted,
}));

const PUBLIRA_AUTH_SECRET = "test-secret-value-that-is-long-enough-000000";
const COOKIE_NAME = "publira_web_platform_auth";
const RETURN_TO_HEADER_NAME = "x-publira-return-to";

const sealedCookie = (expiresAt: string): Promise<string> =>
  encryptSessionPayload(
    { accessToken: "header.payload.signature", expiresAt },
    PUBLIRA_AUTH_SECRET
  );

const activeCookie = (): Promise<string> =>
  sealedCookie(Temporal.Now.instant().add({ minutes: 5 }).toString());

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

describe("web-platform proxy session handling", () => {
  beforeAll(() => {
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSetupCompleted.mockResolvedValue(true);
  });

  it("復号できない Cookie は保護ルートへ通さず削除する", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://platform.example.com/tenants", "not-a-session")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("期限切れ Cookie も保護ルートへ通さず削除する", async () => {
    const cookie = await sealedCookie(
      Temporal.Now.instant().subtract({ minutes: 1 }).toString()
    );
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://platform.example.com/tenants", cookie)
    );

    expect(response.status).toBe(307);
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("有効な Cookie の保護ルートには戻り先パスを添えて通す", async () => {
    const cookie = await activeCookie();
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://platform.example.com/tenants?token=abc", cookie)
    );

    expect(response.headers.get("location")).toBeNull();
    expect(
      response.headers.get(`x-middleware-request-${RETURN_TO_HEADER_NAME}`)
    ).toBe("/tenants?token=abc");
  });

  /**
   * Without the marker the console keeps handing the same dead cookie back to
   * the API: it still decrypts and has not reached its local expiry, so the
   * proxy waves every protected route through to a page that redirects here
   * again (#607 acceptance criteria). The proxy is the only place that can drop
   * it, because a page cannot write cookies while it renders.
   */
  it("失効由来の /login では Cookie を削除する", async () => {
    const cookie = await activeCookie();
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request(
        "https://platform.example.com/login?next=%2Ftenants&reason=session_revoked",
        cookie
      )
    );

    expect(response.headers.get("location")).toBeNull();
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("マーカーの無い /login では Cookie を残す", async () => {
    const cookie = await activeCookie();
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://platform.example.com/login", cookie)
    );

    expect(deletedCookieNames(response)).toEqual([]);
  });

  it("失効マーカーは保護ルートでは効かない", async () => {
    const cookie = await activeCookie();
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request(
        "https://platform.example.com/tenants?reason=session_revoked",
        cookie
      )
    );

    expect(response.headers.get("location")).toBeNull();
    expect(deletedCookieNames(response)).toEqual([]);
  });

  it("セットアップ未完了なら死んだ Cookie を消して /setup へ送る", async () => {
    mockIsSetupCompleted.mockResolvedValue(false);
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://platform.example.com/tenants", "not-a-session")
    );

    expect(response.headers.get("location")).toContain("/setup");
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });
});
