import { describe, expect, it } from "vitest";

import { parseLoginSearchParams } from "./search-params";

describe("parseLoginSearchParams", () => {
  it("reads a same-origin returnTo and a reset flag", () => {
    expect(
      parseLoginSearchParams({
        error: "  Something went wrong  ",
        reset: "done",
        returnTo: "/my",
      })
    ).toEqual({
      errorMessage: "Something went wrong",
      resetDone: true,
      returnToPath: "/my",
      sessionRevoked: false,
      signUpClosed: false,
    });
  });

  it("neutralizes an open-redirect returnTo and drops a bad error", () => {
    expect(
      parseLoginSearchParams({
        error: ["a", "b"],
        reason: "nope",
        reset: "nope",
        returnTo: "https://evil.example",
      })
    ).toEqual({
      errorMessage: undefined,
      resetDone: false,
      returnToPath: "/",
      sessionRevoked: false,
      signUpClosed: false,
    });
  });

  it("defaults to the home path when the query is empty", () => {
    expect(parseLoginSearchParams({})).toEqual({
      errorMessage: undefined,
      resetDone: false,
      returnToPath: "/",
      sessionRevoked: false,
      signUpClosed: false,
    });
  });

  it("Set up a re-login guide only for /login due to invalidation", () => {
    expect(
      parseLoginSearchParams({ reason: "session_revoked", returnTo: "/my" })
    ).toEqual({
      errorMessage: undefined,
      resetDone: false,
      returnToPath: "/my",
      sessionRevoked: true,
      signUpClosed: false,
    });
  });

  it("Show the closed sign-up notice for a refused first sign-in", () => {
    expect(
      parseLoginSearchParams({ reason: "sign_up_closed", returnTo: "/my" })
    ).toEqual({
      errorMessage: undefined,
      resetDone: false,
      returnToPath: "/my",
      sessionRevoked: false,
      signUpClosed: true,
    });
  });
});
