import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantDefaultLocale, mockRedirect, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockGetTenantDefaultLocale: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("./api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("./tenant", () => ({
  getTenantDefaultLocale: mockGetTenantDefaultLocale,
}));

const importAuthSession = () => import("./auth-session");
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("web-host auth-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDefaultLocale.mockResolvedValue("ja");
  });

  it("redirectToLogin は sanitize した returnTo と失効理由を付けて /login へ送る", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin("ja", "/settings", tenantId)).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?returnTo=%2Fsettings&reason=session_revoked"
    );
  });

  it("redirectToLogin は外部 URL を返送先にしない", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(
      redirectToLogin("en", "https://evil.example.com", tenantId)
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/en/login?returnTo=%2F&reason=session_revoked"
    );
  });

  it("requirePublicSession はトークンがあればそれを返す", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("session-token");
    const { requirePublicSession } = await importAuthSession();

    await expect(requirePublicSession("ja", "/my", tenantId)).resolves.toBe(
      "session-token"
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("requirePublicSession はトークンが無ければ再ログインへ送る", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    const { requirePublicSession } = await importAuthSession();

    await expect(requirePublicSession("ja", "/my", tenantId)).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?returnTo=%2Fmy&reason=session_revoked"
    );
  });

  it("withPublicSessionReauth は成功値をそのまま返す", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    await expect(
      withPublicSessionReauth(
        "ja",
        "/settings",
        () => Promise.resolve("ok"),
        tenantId
      )
    ).resolves.toBe("ok");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPublicSessionReauth は Unauthenticated のときだけ再ログインへ送る", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    await expect(
      withPublicSessionReauth(
        "en",
        "/settings",
        () =>
          Promise.reject(
            new ConnectError("invalid token", Code.Unauthenticated)
          ),
        tenantId
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/en/login?returnTo=%2Fsettings&reason=session_revoked"
    );
  });

  it("withPublicSessionReauth はビジネスエラーを再認証扱いにしない", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    // A wrong password reaches the client as invalid_argument (#679); turning it
    // into a re-login would log a reader out over a typo.
    await expect(
      withPublicSessionReauth(
        "ja",
        "/settings",
        () =>
          Promise.reject(
            new ConnectError("invalid password", Code.InvalidArgument)
          ),
        tenantId
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPublicSessionReauth は RPC 以外の失敗も伝播する", async () => {
    const { withPublicSessionReauth } = await importAuthSession();

    await expect(
      withPublicSessionReauth(
        "ja",
        "/settings",
        () => Promise.reject(new Error("boom")),
        tenantId
      )
    ).rejects.toThrow("boom");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
