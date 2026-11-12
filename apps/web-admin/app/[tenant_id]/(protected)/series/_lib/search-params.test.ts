import { describe, expect, it } from "vitest";

import { parseSeriesFilters } from "./search-params";

describe("parseSeriesFilters", () => {
  it("normalizes the filters and cursor token", () => {
    expect(
      parseSeriesFilters({
        age_rating: " r15 ",
        label_id: " 018f0e6a-1000-7000-8000-000000000001 ",
        status: " completed ",
        token: " page-token ",
      })
    ).toEqual({
      ageRating: "r15",
      labelId: "018f0e6a-1000-7000-8000-000000000001",
      status: "completed",
      token: "page-token",
    });
  });

  it("uses the unfiltered first page for repeated or unsupported values", () => {
    expect(
      parseSeriesFilters({
        age_rating: "unknown",
        label_id: "LABEL001",
        status: ["ongoing", "completed"],
        token: ["first", "second"],
      })
    ).toEqual({ ageRating: "", labelId: "", status: "", token: "" });
  });
});
