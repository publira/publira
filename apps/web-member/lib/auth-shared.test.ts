import { describe, expect, it } from "vitest";

import {
  buildLoginUrl,
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

describe("web-member auth-shared", () => {
  it("cookie 名は公開セッション用を使う", () => {
    expect(PUBLIC_SESSION_COOKIE_NAME).toBe("publira_public_session");
  });

  it("buildLoginUrl は returnTo を引き継ぐ", () => {
    const url = buildLoginUrl(
      new URL("https://member.example.com/me?from=settings")
    );

    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("returnTo")).toBe("/me?from=settings");
  });

  it("sanitizeRedirectPath は無効値をルートにフォールバックする", () => {
    expect(sanitizeRedirectPath(null)).toBe("/");
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/");
  });
});
