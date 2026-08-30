import { Code, ConnectError } from "@publira/api-client/errors";
import { encryptSessionPayload } from "@publira/web-session";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildLoginPath,
  buildLoginUrl,
  hasActivePublicSessionCookie,
  isSessionRevokedRedirect,
  isUnauthenticatedError,
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

const PUBLIRA_AUTH_SECRET = "test-secret-value-that-is-long-enough-000000";

const sealedCookie = (expiresAt: string): Promise<string> =>
  encryptSessionPayload(
    { accessToken: "header.payload.signature", expiresAt },
    PUBLIRA_AUTH_SECRET
  );

describe("web-host auth-shared", () => {
  beforeAll(() => {
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  it("cookie 名は公開セッション用を使う", () => {
    expect(PUBLIC_SESSION_COOKIE_NAME).toBe("publira_web_host_auth");
  });

  it("buildLoginUrl は正規の /login へ returnTo を引き継ぐ", () => {
    const url = buildLoginUrl(
      new URL("https://example.com/ja/me?from=settings"),
      "ja",
      "ja"
    );

    expect(url.pathname).toBe("/login");
    // `returnTo` は locale を落とした形で保存する。
    expect(url.searchParams.get("returnTo")).toBe("/me?from=settings");
  });

  it("sanitizeRedirectPath は外部URLと login パスを拒否し、locale を落とす", () => {
    expect(sanitizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/en/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("https://example.com")).toBe("/");
    expect(sanitizeRedirectPath("/login?returnTo=/dashboard")).toBe("/");
    // locale 付きの /login も再ログインループを作らせない。
    expect(sanitizeRedirectPath("/ja/login?returnTo=/dashboard")).toBe("/");
    expect(sanitizeRedirectPath(null)).toBe("/");
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/");
    expect(sanitizeRedirectPath("/\\evil.example.com")).toBe("/");
  });

  it("buildLoginPath は returnTo を sanitize し、失効時だけ理由を付ける", () => {
    expect(buildLoginPath("ja", "ja", "/settings")).toBe(
      "/login?returnTo=%2Fsettings"
    );
    expect(buildLoginPath("en", "ja", "/settings")).toBe(
      "/en/login?returnTo=%2Fsettings"
    );
    expect(buildLoginPath("ja", "ja", "https://evil.example.com")).toBe(
      "/login?returnTo=%2F"
    );
    expect(buildLoginPath("ja", "ja", "/settings", { revoked: true })).toBe(
      "/login?returnTo=%2Fsettings&reason=session_revoked"
    );
  });

  it("isSessionRevokedRedirect は失効由来の /login だけを認める", () => {
    expect(
      isSessionRevokedRedirect(
        new URL("https://example.com/login?returnTo=%2Fsettings")
      )
    ).toBe(false);
    expect(
      isSessionRevokedRedirect(
        new URL("https://example.com/login?reason=session_revoked")
      )
    ).toBe(true);
    expect(
      isSessionRevokedRedirect(
        new URL("https://example.com/login?reason=other")
      )
    ).toBe(false);
  });

  it("isUnauthenticatedError は Unauthenticated だけを再認証扱いにする", () => {
    expect(
      isUnauthenticatedError(new ConnectError("nope", Code.Unauthenticated))
    ).toBe(true);
    // A wrong password is invalid_argument, so it stays a form error (#679).
    expect(
      isUnauthenticatedError(new ConnectError("bad", Code.InvalidArgument))
    ).toBe(false);
    expect(isUnauthenticatedError(new Error("boom"))).toBe(false);
  });

  describe("hasActivePublicSessionCookie", () => {
    it("復号できて期限内の Cookie だけを有効とみなす", async () => {
      const active = await sealedCookie(
        Temporal.Now.instant().add({ minutes: 1 }).toString()
      );

      await expect(hasActivePublicSessionCookie(active)).resolves.toBe(true);
    });

    it("期限切れ・復号失敗・空を無効とみなす", async () => {
      const expired = await sealedCookie(
        Temporal.Now.instant().subtract({ minutes: 1 }).toString()
      );

      await expect(hasActivePublicSessionCookie(expired)).resolves.toBe(false);
      await expect(hasActivePublicSessionCookie("garbage")).resolves.toBe(
        false
      );
      await expect(hasActivePublicSessionCookie("  ")).resolves.toBe(false);
      await expect(hasActivePublicSessionCookie()).resolves.toBe(false);
    });
  });
});
