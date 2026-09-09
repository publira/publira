import { describe, expect, it } from "vitest";

import { parseRankingSearchParams, rankingHref } from "./search-params";

describe("parseRankingSearchParams", () => {
  it("keeps a period the ranking has and the token beside it", () => {
    expect(
      parseRankingSearchParams({ period: " weekly ", token: " djF8Zg-_ " })
    ).toEqual({
      period: "weekly",
      token: "djF8Zg-_",
    });
  });

  it("shows the daily ranking when the URL names no period", () => {
    expect(parseRankingSearchParams({})).toEqual({
      period: "daily",
      token: "",
    });
  });

  it("falls back to the daily ranking for a period that does not exist", () => {
    expect(parseRankingSearchParams({ period: "monthly" })).toEqual({
      period: "daily",
      token: "",
    });
  });

  it("discards a token that is not base64url", () => {
    expect(
      parseRankingSearchParams({ period: "weekly", token: "djF8Zg==" })
    ).toEqual({
      period: "weekly",
      token: "",
    });
  });
});

describe("rankingHref", () => {
  it("leaves the default period out of the query, so one address serves it", () => {
    expect(rankingHref("daily")).toBe("/ranking");
  });

  it("names the other period", () => {
    expect(rankingHref("weekly")).toBe("/ranking?period=weekly");
  });

  it("carries the token beside the period it was issued for", () => {
    expect(rankingHref("weekly", "djF8Zg")).toBe(
      "/ranking?period=weekly&token=djF8Zg"
    );
  });

  it("carries a token of the default period on its own", () => {
    expect(rankingHref("daily", "djF8Zg")).toBe("/ranking?token=djF8Zg");
  });
});
