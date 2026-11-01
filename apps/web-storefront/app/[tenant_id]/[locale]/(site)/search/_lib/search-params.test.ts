import { describe, expect, it } from "vitest";

import { UNNARROWED_SERIES_SEARCH } from "#lib/series-filters";

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
      filters: UNNARROWED_SERIES_SEARCH,
      kind: "series",
      query: "Seed",
      token: "djF8Zg-_",
    });
  });

  it("shows the prompt when q is missing", () => {
    expect(parseSearchPageSearchParams({})).toEqual({
      filters: UNNARROWED_SERIES_SEARCH,
      kind: "all",
      query: "",
      token: "",
    });
  });

  it("truncates an over-long query at the limit, counting non-ASCII characters", () => {
    const longQuery = "あ".repeat(120);
    expect(parseSearchPageSearchParams({ q: longQuery })).toEqual({
      filters: UNNARROWED_SERIES_SEARCH,
      kind: "all",
      query: "あ".repeat(100),
      token: "",
    });
  });

  it("discards a token that is not base64url", () => {
    expect(
      parseSearchPageSearchParams({
        kind: "creators",
        q: "Seed",
        token: "djF8Zg==",
      })
    ).toEqual({
      filters: UNNARROWED_SERIES_SEARCH,
      kind: "creators",
      query: "Seed",
      token: "",
    });
  });

  it("falls back to the overview for a kind no group answers to", () => {
    expect(
      parseSearchPageSearchParams({ kind: "episodes", q: "Seed" })
    ).toEqual({
      filters: UNNARROWED_SERIES_SEARCH,
      kind: "all",
      query: "Seed",
      token: "",
    });
  });

  it("reads the series list's sort and filters under the series list's keys", () => {
    expect(
      parseSearchPageSearchParams({
        free: "1",
        genre: "GENRE123abcd",
        order: "updated",
        q: "Seed",
        status: "completed",
      })
    ).toEqual({
      filters: {
        free: true,
        genre: "GENRE123abcd",
        order: "updated",
        status: "completed",
      },
      kind: "series",
      query: "Seed",
      token: "",
    });
  });

  it("answers a narrowed search with the series group, whatever group the URL names", () => {
    expect(
      parseSearchPageSearchParams({
        kind: "creators",
        q: "Seed",
        status: "ongoing",
        token: "djF8Zg",
      })
    ).toMatchObject({ kind: "series", token: "djF8Zg" });
    expect(
      parseSearchPageSearchParams({ order: "title", q: "Seed" })
    ).toMatchObject({ kind: "series" });
  });

  it("keeps the overview for the empty fields a submitted form writes", () => {
    expect(
      parseSearchPageSearchParams({
        genre: "",
        order: "",
        q: "Seed",
        status: "",
      })
    ).toEqual({
      filters: UNNARROWED_SERIES_SEARCH,
      kind: "all",
      query: "Seed",
      token: "",
    });
  });

  it("drops a value the series list would not take either", () => {
    expect(
      parseSearchPageSearchParams({
        genre: "not-a-genre",
        order: "relevance",
        q: "Seed",
        status: "paused",
      })
    ).toMatchObject({ filters: UNNARROWED_SERIES_SEARCH, kind: "all" });
  });

  it("drops a token that arrives with the overview, which pages nothing", () => {
    expect(parseSearchPageSearchParams({ q: "Seed", token: "djF8Zg" })).toEqual(
      {
        filters: UNNARROWED_SERIES_SEARCH,
        kind: "all",
        query: "Seed",
        token: "",
      }
    );
  });
});

describe("searchPageHref", () => {
  it("puts q, kind, and token in the query", () => {
    expect(
      searchPageHref({ kind: "labels", query: "Seed Series", token: "djF8Zg" })
    ).toBe("/search?q=Seed+Series&kind=labels&token=djF8Zg");
  });

  it("leaves only q when the kind is the overview", () => {
    expect(searchPageHref({ query: "Seed" })).toBe("/search?q=Seed");
  });

  it("leaves only q and kind when the token is empty", () => {
    expect(searchPageHref({ kind: "creators", query: "Seed" })).toBe(
      "/search?q=Seed&kind=creators"
    );
  });

  it("drops a token handed to the overview, which has no pages to name", () => {
    expect(
      searchPageHref({ kind: "all", query: "Seed", token: "djF8Zg" })
    ).toBe("/search?q=Seed");
  });

  it("writes the series group's sort and filters under the series list's keys", () => {
    expect(
      searchPageHref({
        filters: {
          free: true,
          genre: "GENRE123abcd",
          order: "newest",
          status: "hiatus",
        },
        kind: "series",
        query: "Seed",
        token: "djF8Zg",
      })
    ).toBe(
      "/search?q=Seed&kind=series&genre=GENRE123abcd&order=newest&status=hiatus&free=1&token=djF8Zg"
    );
  });

  it("leaves the filters off a group they do not narrow", () => {
    expect(
      searchPageHref({
        filters: { ...UNNARROWED_SERIES_SEARCH, status: "ongoing" },
        query: "Seed",
      })
    ).toBe("/search?q=Seed");
  });

  it("round-trips a narrowed search through the parser", () => {
    const filters = {
      free: false,
      genre: "",
      order: "title" as const,
      status: "ongoing" as const,
    };

    const href = searchPageHref({ filters, kind: "series", query: "Seed" });

    const params = Object.fromEntries(
      new URL(href, "https://example.com").searchParams
    );

    expect(parseSearchPageSearchParams(params)).toEqual({
      filters,
      kind: "series",
      query: "Seed",
      token: "",
    });
  });

  it("returns to the top search screen when everything is empty", () => {
    expect(searchPageHref({ query: "" })).toBe("/search");
  });
});
