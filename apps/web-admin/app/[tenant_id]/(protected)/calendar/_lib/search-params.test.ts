import { describe, expect, it } from "vitest";

import { parseCalendarSearchParams } from "./search-params";

describe("parseCalendarSearchParams", () => {
  it("reads a YYYY-MM month", () => {
    expect(parseCalendarSearchParams({ month: " 2026-08 " })).toEqual({
      month: "2026-08",
    });
  });

  it("leaves the month unset when none was asked for", () => {
    expect(parseCalendarSearchParams({})).toEqual({ month: "" });
  });

  it.each(["2026-13", "2026-00", "2026-8", "2026-08-01", "+010000-01", "may"])(
    "drops %s rather than failing the page",
    (month) => {
      expect(parseCalendarSearchParams({ month })).toEqual({ month: "" });
    }
  );

  it("drops a repeated parameter", () => {
    expect(
      parseCalendarSearchParams({ month: ["2026-08", "2026-09"] })
    ).toEqual({ month: "" });
  });
});
