import { describe, expect, it } from "vitest";

import { parseCommentFilters } from "./search-params";

describe("parseCommentFilters", () => {
  it("reads the six filters the screen carries", () => {
    expect(
      parseCommentFilters({
        episode: "EPISODE001",
        report_status: "open",
        report_token: "report-cursor-token",
        series: "SERIES001",
        status: "pending",
        token: "cursor-token",
      })
    ).toEqual({
      episode: "EPISODE001",
      reportStatus: "open",
      reportToken: "report-cursor-token",
      series: "SERIES001",
      status: "pending",
      token: "cursor-token",
    });
  });

  it("falls back to no filter at all when the query is empty", () => {
    expect(parseCommentFilters({})).toEqual({
      episode: "",
      reportStatus: "",
      reportToken: "",
      series: "",
      status: "",
      token: "",
    });
  });

  it("drops a state the API does not accept rather than passing it on", () => {
    expect(parseCommentFilters({ status: "removed" }).status).toBe("");
  });

  // The two lists take different states, so neither vocabulary may leak into
  // the other's filter.
  it("drops a report state the API does not accept", () => {
    expect(parseCommentFilters({ report_status: "pending" }).reportStatus).toBe(
      ""
    );
  });

  it("keeps the rest of the filters when one of them is unusable", () => {
    expect(
      parseCommentFilters({
        report_status: "open",
        series: "SERIES001",
        status: ["pending", "hidden"],
      })
    ).toEqual({
      episode: "",
      reportStatus: "open",
      reportToken: "",
      series: "SERIES001",
      status: "",
      token: "",
    });
  });
});
