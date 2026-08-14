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
    });
  });

  it("defaults to the home path when the query is empty", () => {
    expect(parseLoginSearchParams({})).toEqual({
      defaultEmail: "",
      errorMessage: undefined,
      invitedDone: false,
      nextPath: "/",
      passwordResetDone: false,
    });
  });
});
