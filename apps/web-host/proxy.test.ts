import { encryptSessionPayload } from "@publira/web-session";
import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveTenantId } = vi.hoisted(() => ({
  mockResolveTenantId: vi.fn(),
}));

vi.mock("./lib/api-client", () => ({
  apiClient: {},
}));

vi.mock("./lib/tenant-resolution", () => ({
  createTenantIdResolver: () => mockResolveTenantId,
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
    mockResolveTenantId.mockResolvedValue(TENANT_ID);
  });

  it("Cookie が無い会員ページはログインへ送る", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(request("https://shop.example.com/settings"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe("/settings");
  });

  it("復号できない Cookie は会員ページからの送出時に削除する", async () => {
    const { proxy } = await import("./proxy");

    const response = await proxy(
      request("https://shop.example.com/settings", "not-a-session")
    );

    expect(response.headers.get("location")).toContain("/login");
    expect(deletedCookieNames(response)).toContain(COOKIE_NAME);
  });

  it("有効なセッションで /login を開いたら会員ページへ戻す", async () => {
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
  it("失効由来の /login は弾き返さず、Cookie を削除して表示する", async () => {
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

  it("失効マーカーは会員ページでは効かない", async () => {
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
