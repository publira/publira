import { describe, expect, it } from "vitest";

import { parseLoginSearchParams } from "./search-params";

describe("parseLoginSearchParams", () => {
  it("reads a same-origin returnTo and a reset flag", () => {
    expect(
      parseLoginSearchParams({
        error: "  失敗しました  ",
        reset: "done",
        returnTo: "/my",
      })
    ).toEqual({
      errorMessage: "失敗しました",
      resetDone: true,
      returnToPath: "/my",
    });
  });

  it("neutralizes an open-redirect returnTo and drops a bad error", () => {
    expect(
      parseLoginSearchParams({
        error: ["a", "b"],
        reset: "nope",
        returnTo: "https://evil.example",
      })
    ).toEqual({
      errorMessage: undefined,
      resetDone: false,
      returnToPath: "/",
    });
  });

  it("defaults to the home path when the query is empty", () => {
    expect(parseLoginSearchParams({})).toEqual({
      errorMessage: undefined,
      resetDone: false,
      returnToPath: "/",
    });
  });
});
