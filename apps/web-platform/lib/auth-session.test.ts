import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHeaders, mockRedirect, mockResolveAccessToken } = vi.hoisted(
  () => ({
    mockHeaders: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    mockResolveAccessToken: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: mockHeaders,
}));

vi.mock("./api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

const setReturnTo = (value?: string) => {
  mockHeaders.mockResolvedValue(
    new Headers(value === undefined ? {} : { "x-publira-return-to": value })
  );
};

const importAuthSession = () => import("./auth-session");

describe("web-platform auth-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setReturnTo("/tenants?token=abc");
  });

  it("redirectToLogin は proxy が記録したパスと失効理由を付けて /login へ送る", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("redirectToLogin は外部 URL を返送先にしない", async () => {
    setReturnTo("https://evil.example.com");
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2F&reason=session_revoked"
    );
  });

  it("redirectToLogin はヘッダーが無ければコンソール直下へ戻す", async () => {
    setReturnTo();
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2F&reason=session_revoked"
    );
  });

  it("redirectToLoginIfSessionRejected は失効した読み取りだけを再ログインへ送る", async () => {
    const { redirectToLoginIfSessionRejected } = await importAuthSession();

    // Any one of the reads a screen awaits is enough to end the session.
    await expect(
      redirectToLoginIfSessionRejected(
        { ok: true },
        { ok: false, requiresSignIn: true }
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    mockRedirect.mockClear();
    await redirectToLoginIfSessionRejected(
      { ok: false, requiresSignIn: false },
      { ok: true }
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("requirePlatformSession はトークンがあればそれを返す", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("session-token");
    const { requirePlatformSession } = await importAuthSession();

    await expect(requirePlatformSession()).resolves.toBe("session-token");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("requirePlatformSession はトークンが無ければ再ログインへ送る", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    const { requirePlatformSession } = await importAuthSession();

    await expect(requirePlatformSession()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("withPlatformSessionReauth は成功値をそのまま返す", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(
      withPlatformSessionReauth(() => Promise.resolve("ok"))
    ).resolves.toBe("ok");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPlatformSessionReauth は Unauthenticated のときだけ再ログインへ送る", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(
      withPlatformSessionReauth(() =>
        Promise.reject(new ConnectError("invalid token", Code.Unauthenticated))
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("withPlatformSessionReauth はビジネスエラーを再認証扱いにしない", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    // A wrong current password reaches the client as invalid_argument (#679);
    // turning it into a re-login would log the operator out over a typo.
    await expect(
      withPlatformSessionReauth(() =>
        Promise.reject(
          new ConnectError("invalid current password", Code.InvalidArgument)
        )
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPlatformSessionReauth は RPC 以外の失敗も伝播する", async () => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(
      withPlatformSessionReauth(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withPlatformSessionReauth は Cookie が無ければ RPC を呼ばずに再ログインへ送る", async () => {
    // A missing cookie never reaches the API, so the mutation would answer with
    // the form error this flow replaces instead of throwing Unauthenticated.
    mockResolveAccessToken.mockResolvedValue("");
    const run = vi.fn();
    const { withPlatformSessionReauth } = await importAuthSession();

    await expect(withPlatformSessionReauth(run)).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(run).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Ftenants%3Ftoken%3Dabc&reason=session_revoked"
    );
  });
});
