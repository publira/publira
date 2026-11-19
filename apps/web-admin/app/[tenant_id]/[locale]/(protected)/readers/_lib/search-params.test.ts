import { describe, expect, it } from "vitest";

import { parseReaderFilters } from "./search-params";

describe("parseReaderFilters", () => {
  it("reads the search, the state, and the cursor", () => {
    expect(
      parseReaderFilters({
        q: " reader@example.com ",
        status: "suspended",
        token: "cursor-token",
      })
    ).toEqual({
      query: "reader@example.com",
      status: "suspended",
      token: "cursor-token",
    });
  });

  it("falls back to no filter at all when the query is empty", () => {
    expect(parseReaderFilters({})).toEqual({
      query: "",
      status: "",
      token: "",
    });
  });

  it("drops a state the API does not accept rather than passing it on", () => {
    expect(parseReaderFilters({ status: "deleted" }).status).toBe("");
  });

  it("keeps the rest of the filters when one of them is unusable", () => {
    expect(
      parseReaderFilters({
        q: "Reader",
        status: ["active", "suspended"],
      })
    ).toEqual({
      query: "Reader",
      status: "",
      token: "",
    });
  });
});
