import { describe, expect, it } from "vitest";

import { parseSearchPageSearchParams, searchPageHref } from "./search-params";

describe("parseSearchPageSearchParams", () => {
  it("Normalize q and token", () => {
    expect(
      parseSearchPageSearchParams({ q: "  Seed  ", token: " djF8Zg-_ " })
    ).toEqual({
      query: "Seed",
      token: "djF8Zg-_",
    });
  });

  it("If q is missing, the search screen will be empty.", () => {
    expect(parseSearchPageSearchParams({})).toEqual({
      query: "",
      token: "",
    });
  });

  it("Cut q that is too long at the upper limit", () => {
    const longQuery = "あ".repeat(120);
    expect(parseSearchPageSearchParams({ q: longQuery })).toEqual({
      query: "あ".repeat(100),
      token: "",
    });
  });

  it("Discard tokens other than base64url", () => {
    expect(
      parseSearchPageSearchParams({ q: "Seed", token: "djF8Zg==" })
    ).toEqual({
      query: "Seed",
      token: "",
    });
  });
});

describe("searchPageHref", () => {
  it("Put q and token in the query", () => {
    expect(searchPageHref("Seed Series", "djF8Zg")).toBe(
      "/search?q=Seed+Series&token=djF8Zg"
    );
  });

  it("If token is empty, leave only q", () => {
    expect(searchPageHref("Seed", "")).toBe("/search?q=Seed");
  });

  it("If both are empty, return to the top search screen", () => {
    expect(searchPageHref("", "")).toBe("/search");
  });
});
