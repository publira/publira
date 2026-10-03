import { describe, expect, it } from "vitest";

import { parseRankingSearchParams, rankingGenreFor } from "./search-params";

describe("parseRankingSearchParams", () => {
  it("keeps a period and rating the ranking has and the token beside them", () => {
    expect(
      parseRankingSearchParams({
        period: " weekly ",
        rating: " r18 ",
        token: " djF8Zg-_ ",
      })
    ).toEqual({
      genre: "",
      period: "weekly",
      rating: "r18",
      token: "djF8Zg-_",
    });
  });

  it("shows the daily all-ages ranking when the URL names neither", () => {
    expect(parseRankingSearchParams({})).toEqual({
      genre: "",
      period: "daily",
      rating: "all",
      token: "",
    });
  });

  it("falls back to the daily ranking for a period that does not exist", () => {
    expect(parseRankingSearchParams({ period: "monthly" })).toEqual({
      genre: "",
      period: "daily",
      rating: "all",
      token: "",
    });
  });

  it("falls back to the all-ages ranking for a rating that does not exist", () => {
    expect(
      parseRankingSearchParams({ period: "weekly", rating: "r21" })
    ).toEqual({
      genre: "",
      period: "weekly",
      rating: "all",
      token: "",
    });
  });

  it("discards a token that is not base64url", () => {
    expect(
      parseRankingSearchParams({ period: "weekly", token: "djF8Zg==" })
    ).toEqual({
      genre: "",
      period: "weekly",
      rating: "all",
      token: "",
    });
  });

  it("keeps the genre the URL names beside the period", () => {
    expect(
      parseRankingSearchParams({ genre: " GENRE0000001 ", period: "weekly" })
    ).toEqual({
      genre: "GENRE0000001",
      period: "weekly",
      rating: "all",
      token: "",
    });
  });

  it("keeps a genre that names nothing, so the page can answer not found", () => {
    expect(parseRankingSearchParams({ genre: "not-a-genre" }).genre).toBe(
      "not-a-genre"
    );
  });

  it("cuts an over-long genre down rather than dropping it to the tenant-wide chart", () => {
    expect(parseRankingSearchParams({ genre: "x".repeat(300) }).genre).not.toBe(
      ""
    );
  });

  it("keeps a genre repeated with different values as one that names nothing, so the page can answer not found", () => {
    const { genre } = parseRankingSearchParams({
      genre: ["GENRE0000001", "GENRE0000002"],
    });

    expect(genre).not.toBe("");
    expect(genre).not.toBe("GENRE0000001");
    expect(genre).not.toBe("GENRE0000002");
  });

  it("reads an empty genre as the tenant-wide chart", () => {
    expect(parseRankingSearchParams({ genre: " " }).genre).toBe("");
  });

  it("reads a genre repeated with the same value as that genre", () => {
    expect(
      parseRankingSearchParams({ genre: ["GENRE0000001", "GENRE0000001"] })
        .genre
    ).toBe("GENRE0000001");
  });
});

describe("rankingGenreFor", () => {
  it("keeps the genre on the all-ages chart", () => {
    expect(rankingGenreFor("all", "GENRE0000001")).toBe("GENRE0000001");
  });

  it("drops the genre on a rated chart, which is always tenant-wide", () => {
    expect(rankingGenreFor("r15", "GENRE0000001")).toBe("");
    expect(rankingGenreFor("r18", "GENRE0000001")).toBe("");
  });
});
