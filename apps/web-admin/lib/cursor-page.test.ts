import { describe, expect, it } from "vitest";

import {
  cursorPageHref,
  cursorPageHrefs,
  cursorPageRequest,
  cursorPageTokens,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "./cursor-page";

describe("parseCursorSearchParams", () => {
  it("passes a string token through", () => {
    expect(parseCursorSearchParams({ token: " cursor-token " })).toEqual({
      token: "cursor-token",
    });
  });

  it("treats a missing token as the first page", () => {
    expect(parseCursorSearchParams({})).toEqual({ token: "" });
  });

  it("falls back to the first page for a token given as an array", () => {
    expect(
      parseCursorSearchParams({ token: ["cursor-a", "cursor-b"] })
    ).toEqual({ token: "" });
  });
});

describe("cursorPageRequest", () => {
  it("fills in the default page size and an empty token", () => {
    expect(cursorPageRequest()).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      token: "",
    });
  });

  it("prefers the limit and the token that were given", () => {
    expect(cursorPageRequest({ limit: 1, token: "cursor-token" })).toEqual({
      limit: 1,
      token: "cursor-token",
    });
  });
});

describe("cursorPageTokens", () => {
  it("settles an unset token to an empty string", () => {
    expect(cursorPageTokens({})).toEqual({ nextToken: "", previousToken: "" });
  });

  it("returns the tokens of the response untouched", () => {
    expect(
      cursorPageTokens({ nextToken: "next", previousToken: "previous" })
    ).toEqual({ nextToken: "next", previousToken: "previous" });
  });
});

describe("cursorPageHref", () => {
  it("turns a token into an href that is only a query", () => {
    expect(cursorPageHref("cursor-token")).toBe("?token=cursor-token");
  });

  it("returns to the first page for an empty token", () => {
    expect(cursorPageHref("")).toBe("?");
  });
});

describe("cursorPageHrefs", () => {
  it("links only the direction that has a token", () => {
    expect(cursorPageHrefs({ nextToken: "next", previousToken: "" })).toEqual({
      nextHref: "?token=next",
      previousHref: undefined,
    });
  });
});

describe("hasCursorPageLinks", () => {
  it("is true when there is a link in either direction", () => {
    expect(hasCursorPageLinks({ previousHref: "?token=previous" })).toBe(true);
    expect(hasCursorPageLinks({ nextHref: "?token=next" })).toBe(true);
  });

  it("is false when there is no link", () => {
    expect(hasCursorPageLinks({})).toBe(false);
  });
});
