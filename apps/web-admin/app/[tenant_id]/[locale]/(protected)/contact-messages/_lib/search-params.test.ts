import { describe, expect, it } from "vitest";

import { parseContactMessageFilters } from "./search-params";

describe("parseContactMessageFilters", () => {
  it("reads the state and the cursor", () => {
    expect(
      parseContactMessageFilters({
        status: "unhandled",
        token: "cursor-token",
      })
    ).toEqual({ status: "unhandled", token: "cursor-token" });
  });

  it.each(["unhandled", "in_progress", "handled"])(
    "accepts the %s state",
    (status) => {
      expect(parseContactMessageFilters({ status }).status).toBe(status);
    }
  );

  it("falls back to the whole inbox when the query string carries nothing", () => {
    expect(parseContactMessageFilters({})).toEqual({ status: "", token: "" });
  });

  it("drops a state the API does not accept rather than passing it on", () => {
    expect(parseContactMessageFilters({ status: "archived" }).status).toBe("");
  });

  it("keeps the cursor when the state is unusable", () => {
    expect(
      parseContactMessageFilters({
        status: ["handled", "unhandled"],
        token: "cursor-token",
      })
    ).toEqual({ status: "", token: "cursor-token" });
  });
});
