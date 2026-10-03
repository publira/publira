import { describe, expect, it } from "vitest";

import { parseRankingSearchParams } from "./search-params";

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
