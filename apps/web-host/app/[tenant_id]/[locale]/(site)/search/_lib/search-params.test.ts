import { describe, expect, it } from "vitest";

import { parseSearchPageSearchParams, searchPageHref } from "./search-params";

describe("parseSearchPageSearchParams", () => {
  it("normalizes q and token", () => {
    expect(
      parseSearchPageSearchParams({
        kind: "series",
        q: "  Seed  ",
        token: " djF8Zg-_ ",
      })
    ).toEqual({
      kind: "series",
      query: "Seed",
      token: "djF8Zg-_",
    });
  });

  it("shows the prompt when q is missing", () => {
    expect(parseSearchPageSearchParams({})).toEqual({
      kind: "all",
      query: "",
      token: "",
    });
  });

  it("truncates an over-long query at the limit, counting non-ASCII characters", () => {
    const longQuery = "あ".repeat(120);
    expect(parseSearchPageSearchParams({ q: longQuery })).toEqual({
      kind: "all",
      query: "あ".repeat(100),
      token: "",
    });
  });

  it("discards a token that is not base64url", () => {
    expect(
      parseSearchPageSearchParams({
        kind: "authors",
        q: "Seed",
        token: "djF8Zg==",
      })
    ).toEqual({
      kind: "authors",
      query: "Seed",
      token: "",
    });
  });

  it("falls back to the overview for a kind no group answers to", () => {
    expect(
      parseSearchPageSearchParams({ kind: "episodes", q: "Seed" })
    ).toEqual({
      kind: "all",
      query: "Seed",
      token: "",
    });
  });

  it("drops a token that arrives with the overview, which pages nothing", () => {
    expect(parseSearchPageSearchParams({ q: "Seed", token: "djF8Zg" })).toEqual(
      {
        kind: "all",
        query: "Seed",
        token: "",
      }
    );
  });
});

describe("searchPageHref", () => {
  it("puts q, kind, and token in the query", () => {
    expect(searchPageHref("Seed Series", "labels", "djF8Zg")).toBe(
      "/search?q=Seed+Series&kind=labels&token=djF8Zg"
    );
  });

  it("leaves only q when the kind is the overview", () => {
    expect(searchPageHref("Seed")).toBe("/search?q=Seed");
  });

  it("leaves only q and kind when the token is empty", () => {
    expect(searchPageHref("Seed", "authors")).toBe(
      "/search?q=Seed&kind=authors"
    );
  });

  it("drops a token handed to the overview, which has no pages to name", () => {
    expect(searchPageHref("Seed", "all", "djF8Zg")).toBe("/search?q=Seed");
  });

  it("returns to the top search screen when everything is empty", () => {
    expect(searchPageHref("")).toBe("/search");
  });
});
