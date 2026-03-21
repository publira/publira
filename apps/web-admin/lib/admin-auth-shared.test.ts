import { describe, expect, it } from "vitest";

import { sanitizeRedirectPath } from "./admin-auth-shared";

describe("sanitizeRedirectPath", () => {
  it("allows internal paths", () => {
    expect(sanitizeRedirectPath("/series")).toBe("/series");
    expect(sanitizeRedirectPath("/settings?tab=theme")).toBe(
      "/settings?tab=theme"
    );
  });

  it("rejects empty, external, and login paths", () => {
    expect(sanitizeRedirectPath("")).toBe("/");
    expect(sanitizeRedirectPath("https://example.com")).toBe("/");
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/");
    expect(sanitizeRedirectPath("/login")).toBe("/");
    expect(sanitizeRedirectPath("/login?next=/series")).toBe("/");
  });
});
