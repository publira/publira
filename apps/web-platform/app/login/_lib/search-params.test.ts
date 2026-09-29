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

  it("sets a reauthentication reason for expiry-related /login routes", () => {
    expect(
      parseLoginSearchParams({ next: "/tenants", reason: "session_revoked" })
    ).toEqual({
      nextPath: "/tenants",
      passwordResetDone: false,
      sessionRevoked: true,
    });
  });

  it("ignores an unknown reason", () => {
    expect(parseLoginSearchParams({ reason: "whatever" })).toEqual({
      nextPath: "/",
      passwordResetDone: false,
      sessionRevoked: false,
    });
  });
});
