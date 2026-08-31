import { describe, expect, it } from "vitest";

import { parseSeriesListSearchParams, seriesListHref } from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/series`.
describe("parseSeriesListSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseSeriesListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseSeriesListSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseSeriesListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseSeriesListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("seriesListHref", () => {
  it("Construct a query with token", () => {
    expect(seriesListHref("djF8Zg")).toBe("/series?token=djF8Zg");
  });

  it("If token is empty, return to first page", () => {
    expect(seriesListHref("")).toBe("/series");
  });
});
