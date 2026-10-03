import { describe, expect, it } from "vitest";

import { rankingHref } from "./ranking-href";

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

  it("names a genre's chart beside the period", () => {
    expect(
      rankingHref({ genre: "GENRE0000001", period: "weekly", rating: "all" })
    ).toBe("/ranking?genre=GENRE0000001&period=weekly");
  });

  it("leaves an empty genre out, so the tenant-wide chart keeps its address", () => {
    expect(rankingHref({ genre: "", period: "daily", rating: "all" })).toBe(
      "/ranking"
    );
  });
});
