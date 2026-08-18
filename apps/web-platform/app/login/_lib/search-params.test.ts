import { describe, expect, it } from "vitest";

import { parseLoginSearchParams } from "./search-params";

describe("parseLoginSearchParams", () => {
  it("keeps a same-origin next path and a reset flag", () => {
    expect(
      parseLoginSearchParams({ next: "/operators", reset: "done" })
    ).toEqual({
      nextPath: "/operators",
      passwordResetDone: true,
      sessionRevoked: false,
    });
  });

  it("neutralizes an open redirect and ignores an unknown reset value", () => {
    expect(
      parseLoginSearchParams({
        next: "https://evil.example",
        reset: "nope",
      })
    ).toEqual({
      nextPath: "/",
      passwordResetDone: false,
      sessionRevoked: false,
    });
  });

  it("失効由来の /login では再ログイン理由を立てる", () => {
    expect(
      parseLoginSearchParams({ next: "/tenants", reason: "session_revoked" })
    ).toEqual({
      nextPath: "/tenants",
      passwordResetDone: false,
      sessionRevoked: true,
    });
  });

  it("知らない reason は無視する", () => {
    expect(parseLoginSearchParams({ reason: "whatever" })).toEqual({
      nextPath: "/",
      passwordResetDone: false,
      sessionRevoked: false,
    });
  });
});
