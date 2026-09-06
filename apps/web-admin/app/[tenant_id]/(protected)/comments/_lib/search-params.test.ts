import { describe, expect, it } from "vitest";

import { parseCommentFilters } from "./search-params";

describe("parseCommentFilters", () => {
  it("reads the four filters the screen carries", () => {
    expect(
      parseCommentFilters({
        episode: "EPISODE001",
        series: "SERIES001",
        status: "pending",
        token: "cursor-token",
      })
    ).toEqual({
      episode: "EPISODE001",
      series: "SERIES001",
      status: "pending",
      token: "cursor-token",
    });
  });

  it("falls back to no filter at all when the query is empty", () => {
    expect(parseCommentFilters({})).toEqual({
      episode: "",
      series: "",
      status: "",
      token: "",
    });
  });

  it("drops a state the API does not accept rather than passing it on", () => {
    expect(parseCommentFilters({ status: "removed" }).status).toBe("");
  });

  it("keeps the rest of the filters when one of them is unusable", () => {
    expect(
      parseCommentFilters({
        series: "SERIES001",
        status: ["pending", "hidden"],
      })
    ).toEqual({
      episode: "",
      series: "SERIES001",
      status: "",
      token: "",
    });
  });
});
