import { describe, expect, it } from "vitest";

import { parseSeriesFilters } from "./search-params";

describe("parseSeriesFilters", () => {
  it("normalizes the filters and cursor token", () => {
    expect(
      parseSeriesFilters({
        age_rating: " r15 ",
        status: " completed ",
        token: " page-token ",
      })
    ).toEqual({ ageRating: "r15", status: "completed", token: "page-token" });
  });

  it("uses the unfiltered first page for repeated or unsupported values", () => {
    expect(
      parseSeriesFilters({
        age_rating: "unknown",
        status: ["ongoing", "completed"],
        token: ["first", "second"],
      })
    ).toEqual({ ageRating: "", status: "", token: "" });
  });
});
