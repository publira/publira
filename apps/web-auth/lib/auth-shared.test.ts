import { describe, expect, it } from "vitest";

import {
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

describe("web-auth auth-shared", () => {
  it("cookie 名は公開セッション用を使う", () => {
    expect(PUBLIC_SESSION_COOKIE_NAME).toBe("publira_public_session");
  });

  it("sanitizeRedirectPath は外部URLと login パスを拒否する", () => {
    expect(sanitizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("https://example.com")).toBe("/");
    expect(sanitizeRedirectPath("/login?returnTo=/dashboard")).toBe("/");
  });
});
