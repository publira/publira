import { describe, expect, it } from "vitest";

import {
  isNarrowedSeriesList,
  parseSeriesListSearchParams,
  seriesListHref,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`, and the
// sort and filter schemas in `lib/series-filters.test.ts`; these only pin down
// that this list is wired to them and points at `/series`.
describe("parseSeriesListSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseSeriesListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      free: false,
      genre: "",
      order: "newest",
      status: "",
      token: "djF8Zg-_",
    });
  });

  it("With nothing in the query, the list is the newest page one, unnarrowed", () => {
    expect(parseSeriesListSearchParams({})).toEqual({
      free: false,
      genre: "",
      order: "newest",
      status: "",
      token: "",
    });
  });

  it("Reads the sort and the three filters", () => {
    expect(
      parseSeriesListSearchParams({
        free: "1",
        genre: "SeedGENRAAA1",
        order: "title",
        status: "completed",
      })
    ).toEqual({
      free: true,
      genre: "SeedGENRAAA1",
      order: "title",
      status: "completed",
      token: "",
    });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseSeriesListSearchParams({ token: "djF8Zg==" }).token).toBe("");
    expect(parseSeriesListSearchParams({ token: ["a", "b"] }).token).toBe("");
  });

  it("An unknown sort, status, or genre shape narrows nothing", () => {
    expect(
      parseSeriesListSearchParams({
        genre: "not-a-public-id",
        order: "cheapest",
        status: "cancelled",
      })
    ).toEqual({
      free: false,
      genre: "",
      order: "newest",
      status: "",
      token: "",
    });
  });
});

describe("isNarrowedSeriesList", () => {
  it("The sort alone is not a filter", () => {
    expect(
      isNarrowedSeriesList(parseSeriesListSearchParams({ order: "title" }))
    ).toBe(false);
  });

  it("Any of the three filters narrows the list", () => {
    expect(
      isNarrowedSeriesList(parseSeriesListSearchParams({ free: "1" }))
    ).toBe(true);
    expect(
      isNarrowedSeriesList(parseSeriesListSearchParams({ status: "hiatus" }))
    ).toBe(true);
    expect(
      isNarrowedSeriesList(
        parseSeriesListSearchParams({ genre: "SeedGENRAAA1" })
      )
    ).toBe(true);
  });
});

describe("seriesListHref", () => {
  it("Construct a query with token", () => {
    expect(
      seriesListHref(parseSeriesListSearchParams({ token: "djF8Zg" }))
    ).toBe("/series?token=djF8Zg");
  });

  it("Carries the sort and the filters alongside the token", () => {
    expect(
      seriesListHref(
        parseSeriesListSearchParams({
          free: "1",
          genre: "SeedGENRAAA1",
          order: "updated",
          status: "ongoing",
          token: "djF8Zg",
        })
      )
    ).toBe(
      "/series?genre=SeedGENRAAA1&order=updated&status=ongoing&free=1&token=djF8Zg"
    );
  });

  it("The unnarrowed newest page one is the bare path", () => {
    expect(seriesListHref(parseSeriesListSearchParams({}))).toBe("/series");
  });
});
