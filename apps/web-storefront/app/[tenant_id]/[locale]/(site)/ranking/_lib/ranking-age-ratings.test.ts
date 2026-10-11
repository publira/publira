import { describe, expect, it } from "vitest";

import { rankingAgeRatingsFor } from "./ranking-age-ratings";

describe("rankingAgeRatingsFor", () => {
  it("offers every rating where the tenant checks no ages", () => {
    expect(rankingAgeRatingsFor("none")).toEqual(["all", "r15", "r18"]);
  });

  it("keeps a covered rating from a reader who has proven nothing", () => {
    expect(rankingAgeRatingsFor("r18")).toEqual(["all", "r15"]);
    expect(rankingAgeRatingsFor("r15_and_r18")).toEqual(["all"]);
  });

  it("opens a covered rating to a reader whose birth date clears it", () => {
    expect(rankingAgeRatingsFor("r15_and_r18", "r15")).toEqual(["all", "r15"]);
    expect(rankingAgeRatingsFor("r15_and_r18", "r18")).toEqual([
      "all",
      "r15",
      "r18",
    ]);
    expect(rankingAgeRatingsFor("r18", "r18")).toEqual(["all", "r15", "r18"]);
  });

  it("does not open r18 to a reader who has proven only r15", () => {
    expect(rankingAgeRatingsFor("r18", "r15")).toEqual(["all", "r15"]);
  });
});
