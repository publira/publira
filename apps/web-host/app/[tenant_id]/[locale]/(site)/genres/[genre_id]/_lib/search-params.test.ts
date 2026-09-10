import { describe, expect, it } from "vitest";

import {
  genreDetailHref,
  isNarrowedGenreSeries,
  parseGenreDetailParams,
  parseGenreDetailSearchParams,
} from "./search-params";

describe("parseGenreDetailParams", () => {
  it("Pass 12 character Base58 public_id", () => {
    expect(parseGenreDetailParams({ genre_id: " SeedGENRAAA1 " })).toBe(
      "SeedGENRAAA1"
    );
  });

  it("Set genre_id of different shape to null", () => {
    expect(parseGenreDetailParams({ genre_id: "not-a-public-id" })).toBeNull();
    expect(parseGenreDetailParams({ genre_id: "0OOOOOOOOOOO" })).toBeNull();
    expect(parseGenreDetailParams({ genre_id: "" })).toBeNull();
  });
});

describe("parseGenreDetailSearchParams", () => {
  it("With nothing in the query, the genre is the newest page one, unnarrowed", () => {
    expect(parseGenreDetailSearchParams({})).toEqual({
      free: false,
      order: "newest",
      status: "",
      token: "",
    });
  });

  it("Reads the sort and the two filters this screen still offers", () => {
    expect(
      parseGenreDetailSearchParams({
        free: "1",
        order: "updated",
        status: "completed",
        token: " djF8Zg-_ ",
      })
    ).toEqual({
      free: true,
      order: "updated",
      status: "completed",
      token: "djF8Zg-_",
    });
  });

  it("A genre in the query is not a field of this screen", () => {
    expect(
      parseGenreDetailSearchParams({
        genre: "SeedGENRAAA2",
      } as Record<string, string>)
    ).toEqual({
      free: false,
      order: "newest",
      status: "",
      token: "",
    });
  });
});

describe("isNarrowedGenreSeries", () => {
  it("The sort alone is not a filter", () => {
    expect(
      isNarrowedGenreSeries(parseGenreDetailSearchParams({ order: "title" }))
    ).toBe(false);
  });

  it("Either filter narrows the genre", () => {
    expect(
      isNarrowedGenreSeries(parseGenreDetailSearchParams({ free: "1" }))
    ).toBe(true);
    expect(
      isNarrowedGenreSeries(parseGenreDetailSearchParams({ status: "hiatus" }))
    ).toBe(true);
  });
});

describe("genreDetailHref", () => {
  it("Construct a query under the genre's own path", () => {
    expect(
      genreDetailHref(
        "SeedGENRAAA1",
        parseGenreDetailSearchParams({ order: "title", token: "djF8Zg" })
      )
    ).toBe("/genres/SeedGENRAAA1?order=title&token=djF8Zg");
  });

  it("The unnarrowed newest page one is the bare path", () => {
    expect(
      genreDetailHref("SeedGENRAAA1", parseGenreDetailSearchParams({}))
    ).toBe("/genres/SeedGENRAAA1");
  });
});
