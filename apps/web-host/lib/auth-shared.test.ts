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

  it("Use the cookie name for public sessions", () => {
    expect(PUBLIC_SESSION_COOKIE_NAME).toBe("publira_web_host_auth");
  });

  it("buildLoginUrl inherits returnTo to regular /login", () => {
    const url = buildLoginUrl(
      new URL("https://example.com/ja/me?from=settings"),
      "ja",
      "ja"
    );

    expect(url.pathname).toBe("/login");
    // `returnTo` is stored with the locale prefix removed.
    expect(url.searchParams.get("returnTo")).toBe("/me?from=settings");
  });

  it("sanitizeRedirectPath rejects external URLs and login paths and drops locale", () => {
    expect(sanitizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/en/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("https://example.com")).toBe("/");
    expect(sanitizeRedirectPath("/login?returnTo=/dashboard")).toBe("/");
    // A locale-prefixed /login must not create a sign-in loop either.
    expect(sanitizeRedirectPath("/ja/login?returnTo=/dashboard")).toBe("/");
    expect(sanitizeRedirectPath(null)).toBe("/");
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/");
    expect(sanitizeRedirectPath("/\\evil.example.com")).toBe("/");
  });

  it("buildLoginPath sanitizes returnTo and adds a reason only when it expires", () => {
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

  it("isSessionRevokedRedirect only allows /login from revocation", () => {
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

  it("isUnauthenticatedError treats only Unauthenticated as re-authentication", () => {
    expect(
      isUnauthenticatedError(new ConnectError("nope", Code.Unauthenticated))
    ).toBe(true);
    // A wrong password is invalid_argument, so it stays a form error.
    expect(
      isUnauthenticatedError(new ConnectError("bad", Code.InvalidArgument))
    ).toBe(false);
    expect(isUnauthenticatedError(new Error("boom"))).toBe(false);
  });

  describe("hasActivePublicSessionCookie", () => {
    it("Only cookies that can be decrypted and have not expired are considered valid.", async () => {
      const active = await sealedCookie(
        Temporal.Now.instant().add({ minutes: 1 }).toString()
      );

      await expect(hasActivePublicSessionCookie(active)).resolves.toBe(true);
    });

    it("Considers expired, decryption failed, and empty as invalid.", async () => {
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
