import { describe, expect, it } from "vitest";

import {
  buildLoginUrl,
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

describe("web-host auth-shared", () => {
  it("cookie 名は公開セッション用を使う", () => {
    expect(PUBLIC_SESSION_COOKIE_NAME).toBe("publira_web_host_auth");
  });

  it("buildLoginUrl は returnTo を引き継ぐ", () => {
    const url = buildLoginUrl(new URL("https://example.com/me?from=settings"));

    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("returnTo")).toBe("/me?from=settings");
  });

  it("sanitizeRedirectPath は外部URLと login パスを拒否する", () => {
    expect(sanitizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("https://example.com")).toBe("/");
    expect(sanitizeRedirectPath("/login?returnTo=/dashboard")).toBe("/");
    expect(sanitizeRedirectPath(null)).toBe("/");
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/");
  });
});
