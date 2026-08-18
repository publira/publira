import { describe, expect, it } from "vitest";

import { parseLoginSearchParams } from "./search-params";

describe("parseLoginSearchParams", () => {
  it("reads a same-origin next path and flash flags", () => {
    expect(
      parseLoginSearchParams({
        email: "  admin@example.com  ",
        error: "  失敗しました  ",
        invited: "done",
        next: "/series",
        reset: "done",
      })
    ).toEqual({
      defaultEmail: "admin@example.com",
      errorMessage: "失敗しました",
      invitedDone: true,
      nextPath: "/series",
      passwordResetDone: true,
      sessionRevoked: false,
    });
  });

  it("neutralizes an open-redirect next and drops a bad email", () => {
    expect(
      parseLoginSearchParams({
        email: "not-an-email",
        error: ["a", "b"],
        invited: "nope",
        next: "https://evil.example",
        reset: "nope",
      })
    ).toEqual({
      defaultEmail: "",
      errorMessage: undefined,
      invitedDone: false,
      nextPath: "/",
      passwordResetDone: false,
      sessionRevoked: false,
    });
  });

  it("defaults to the home path when the query is empty", () => {
    expect(parseLoginSearchParams({})).toEqual({
      defaultEmail: "",
      errorMessage: undefined,
      invitedDone: false,
      nextPath: "/",
      passwordResetDone: false,
      sessionRevoked: false,
    });
  });

  it("reads the revoked-session marker and keeps the return path", () => {
    expect(
      parseLoginSearchParams({ next: "/series", reason: "session_revoked" })
    ).toMatchObject({
      nextPath: "/series",
      sessionRevoked: true,
    });
  });

  it("ignores an unknown reason", () => {
    expect(parseLoginSearchParams({ reason: "whatever" })).toMatchObject({
      sessionRevoked: false,
    });
  });
});
