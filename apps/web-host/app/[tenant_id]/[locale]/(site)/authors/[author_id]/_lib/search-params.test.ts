import { describe, expect, it } from "vitest";

import {
  authorDetailHref,
  parseAuthorDetailSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this detail route is wired to it and points at the
// author.
describe("parseAuthorDetailSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseAuthorDetailSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseAuthorDetailSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseAuthorDetailSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseAuthorDetailSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("authorDetailHref", () => {
  it("Construct a query with token", () => {
    expect(authorDetailHref("CREATOR_A", "djF8Zg")).toBe(
      "/authors/CREATOR_A?token=djF8Zg"
    );
  });

  it("If token is empty, return to first page", () => {
    expect(authorDetailHref("CREATOR_A", "")).toBe("/authors/CREATOR_A");
  });
});
