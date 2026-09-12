import { SeriesAgeRating } from "@publira/api-client/public/types";
import { describe, expect, it } from "vitest";

import {
  ageRatingMeetsConfirmation,
  toRestrictedAgeRating,
  withRestrictedAgeRating,
} from "./age-rating";

describe("toRestrictedAgeRating", () => {
  it("Keeps only the ratings a reader has to confirm", () => {
    expect(toRestrictedAgeRating(SeriesAgeRating.R15)).toBe("r15");
    expect(toRestrictedAgeRating(SeriesAgeRating.R18)).toBe("r18");
  });

  it("Treats all-ages and a missing field as unrestricted", () => {
    expect(toRestrictedAgeRating(SeriesAgeRating.ALL)).toBeUndefined();
    expect(toRestrictedAgeRating(SeriesAgeRating.UNSPECIFIED)).toBeUndefined();
    expect(toRestrictedAgeRating()).toBeUndefined();
  });
});

describe("ageRatingMeetsConfirmation", () => {
  it("Lets an unrestricted series through without a confirmation", () => {
    expect(ageRatingMeetsConfirmation()).toBe(true);
    expect(ageRatingMeetsConfirmation(undefined, "r15")).toBe(true);
  });

  it("Holds a rated series until this browser has confirmed that rating", () => {
    expect(ageRatingMeetsConfirmation("r15")).toBe(false);
    expect(ageRatingMeetsConfirmation("r18")).toBe(false);
    expect(ageRatingMeetsConfirmation("r15", "r15")).toBe(true);
    expect(ageRatingMeetsConfirmation("r18", "r15")).toBe(false);
  });

  it("Lets an r18 confirmation cover r15 as well", () => {
    expect(ageRatingMeetsConfirmation("r15", "r18")).toBe(true);
    expect(ageRatingMeetsConfirmation("r18", "r18")).toBe(true);
  });
});

describe("withRestrictedAgeRating", () => {
  it("Adds the field only when the series is rated", () => {
    expect(
      withRestrictedAgeRating({ publicId: "SERIES_1" }, SeriesAgeRating.R18)
    ).toEqual({ ageRating: "r18", publicId: "SERIES_1" });
    expect(
      withRestrictedAgeRating({ publicId: "SERIES_1" }, SeriesAgeRating.ALL)
    ).toEqual({ publicId: "SERIES_1" });
  });
});
