import { describe, expect, it } from "vitest";

import { parseOpenMonthSearchParams } from "./search-params";

describe("parseOpenMonthSearchParams", () => {
  it("reads a YYYY-MM month", () => {
    expect(parseOpenMonthSearchParams({ period: " 2026-08 " })).toEqual({
      period: "2026-08",
    });
  });

  it("leaves the month unset when none was asked for", () => {
    expect(parseOpenMonthSearchParams({})).toEqual({ period: "" });
  });

  it.each(["2026-13", "2026-8", "2026-08-01", "august"])(
    "drops %s rather than failing the page",
    (period) => {
      expect(parseOpenMonthSearchParams({ period })).toEqual({ period: "" });
    }
  );

  it("drops a repeated parameter", () => {
    expect(
      parseOpenMonthSearchParams({ period: ["2026-08", "2026-09"] })
    ).toEqual({ period: "" });
  });
});
