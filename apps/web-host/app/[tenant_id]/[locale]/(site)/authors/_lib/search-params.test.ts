import { describe, expect, it } from "vitest";

import { authorsListHref, parseAuthorsListSearchParams } from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/authors`.
describe("parseAuthorsListSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseAuthorsListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseAuthorsListSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseAuthorsListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseAuthorsListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("authorsListHref", () => {
  it("Construct a query with token", () => {
    expect(authorsListHref("djF8Zg")).toBe("/authors?token=djF8Zg");
  });

  it("If token is empty, return to first page", () => {
    expect(authorsListHref("")).toBe("/authors");
  });
});
