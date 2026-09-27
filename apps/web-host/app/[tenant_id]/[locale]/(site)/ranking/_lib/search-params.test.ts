import { describe, expect, it } from "vitest";

import { parseRankingSearchParams, rankingHref } from "./search-params";

describe("parseRankingSearchParams", () => {
  it("keeps a period and rating the ranking has and the token beside them", () => {
    expect(
      parseRankingSearchParams({
        period: " weekly ",
        rating: " r18 ",
        token: " djF8Zg-_ ",
      })
    ).toEqual({
      period: "weekly",
      rating: "r18",
      token: "djF8Zg-_",
    });
  });

  it("shows the daily all-ages ranking when the URL names neither", () => {
    expect(parseRankingSearchParams({})).toEqual({
      period: "daily",
      rating: "all",
      token: "",
    });
  });

  it("falls back to the daily ranking for a period that does not exist", () => {
    expect(parseRankingSearchParams({ period: "monthly" })).toEqual({
      period: "daily",
      rating: "all",
      token: "",
    });
  });

  it("falls back to the all-ages ranking for a rating that does not exist", () => {
    expect(
      parseRankingSearchParams({ period: "weekly", rating: "r21" })
    ).toEqual({
      period: "weekly",
      rating: "all",
      token: "",
    });
  });

  it("discards a token that is not base64url", () => {
    expect(
      parseRankingSearchParams({ period: "weekly", token: "djF8Zg==" })
    ).toEqual({
      period: "weekly",
      rating: "all",
      token: "",
    });
  });
});

describe("rankingHref", () => {
  it("leaves the default period and rating out of the query, so one address serves them", () => {
    expect(rankingHref({ period: "daily", rating: "all" })).toBe("/ranking");
  });

  it("names the other period", () => {
    expect(rankingHref({ period: "weekly", rating: "all" })).toBe(
      "/ranking?period=weekly"
    );
  });

  it("names a rated ranking", () => {
    expect(rankingHref({ period: "daily", rating: "r15" })).toBe(
      "/ranking?rating=r15"
    );
  });

  it("keeps the rating beside the period", () => {
    expect(rankingHref({ period: "weekly", rating: "r18" })).toBe(
      "/ranking?period=weekly&rating=r18"
    );
  });

  it("carries the token beside the period and rating it was issued for", () => {
    expect(
      rankingHref({ period: "weekly", rating: "r18", token: "djF8Zg" })
    ).toBe("/ranking?period=weekly&rating=r18&token=djF8Zg");
  });

  it("carries a token of the default period and rating on its own", () => {
    expect(
      rankingHref({ period: "daily", rating: "all", token: "djF8Zg" })
    ).toBe("/ranking?token=djF8Zg");
  });
});
