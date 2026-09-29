import { describe, expect, it } from "vitest";

import { followsListHref, parseFollowsSearchParams } from "./search-params";

describe("parseFollowsSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseFollowsSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseFollowsSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseFollowsSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseFollowsSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("followsListHref", () => {
  it("Construct a query with token", () => {
    expect(followsListHref("next/page")).toBe(
      "/settings/follows?token=next%2Fpage"
    );
  });

  it("If token is empty, return to first page", () => {
    expect(followsListHref("")).toBe("/settings/follows");
  });
});
