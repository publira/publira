import { SeriesAgeRating } from "@publira/api-client/public/types";
import { describe, expect, it } from "vitest";

import {
  ageRatingSatisfiedBy,
  provenAgeRating,
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

describe("ageRatingSatisfiedBy", () => {
  it("Lets an unrestricted series through without a confirmation", () => {
    expect(ageRatingSatisfiedBy()).toBe(true);
    expect(ageRatingSatisfiedBy(undefined, "r15")).toBe(true);
  });

  it("Holds a rated series until this browser has confirmed that rating", () => {
    expect(ageRatingSatisfiedBy("r15")).toBe(false);
    expect(ageRatingSatisfiedBy("r18")).toBe(false);
    expect(ageRatingSatisfiedBy("r15", "r15")).toBe(true);
    expect(ageRatingSatisfiedBy("r18", "r15")).toBe(false);
  });

  it("Lets an r18 confirmation cover r15 as well", () => {
    expect(ageRatingSatisfiedBy("r15", "r18")).toBe(true);
    expect(ageRatingSatisfiedBy("r18", "r18")).toBe(true);
  });
});

describe("provenAgeRating", () => {
  const today = Temporal.PlainDate.from("2026-09-15");

  it("Reads the highest rating the reader is old enough for", () => {
    expect(provenAgeRating("2008-09-15", today)).toBe("r18");
    expect(provenAgeRating("2011-09-15", today)).toBe("r15");
    expect(provenAgeRating("2011-09-16", today)).toBeUndefined();
  });

  it("Counts a birthday as reached only on the day itself", () => {
    expect(provenAgeRating("2008-09-16", today)).toBe("r15");
  });

  it("Proves nothing for a date this build will not read", () => {
    expect(provenAgeRating("", today)).toBeUndefined();
    expect(provenAgeRating("2008-9-15", today)).toBeUndefined();
    expect(provenAgeRating("not a date", today)).toBeUndefined();
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
