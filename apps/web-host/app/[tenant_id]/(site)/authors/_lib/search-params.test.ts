import { describe, expect, it } from "vitest";

import { parseAuthorsListSearchParams } from "./search-params";

describe("parseAuthorsListSearchParams", () => {
  it("reads a positive page and falls back otherwise", () => {
    expect(parseAuthorsListSearchParams({ page: "3" })).toEqual({ page: 3 });
    expect(parseAuthorsListSearchParams({})).toEqual({ page: 1 });
    expect(parseAuthorsListSearchParams({ page: "0" })).toEqual({ page: 1 });
    expect(parseAuthorsListSearchParams({ page: "abc" })).toEqual({ page: 1 });
  });

  it("does not pick a winner when the same key is repeated with different values", () => {
    expect(parseAuthorsListSearchParams({ page: ["2", "9"] })).toEqual({
      page: 1,
    });
  });
});
