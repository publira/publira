import { describe, expect, it } from "vitest";

import { formatCount, formatDays, formatRating } from "./format";

describe("formatCount", () => {
  it("groups the digits the way the locale does", () => {
    expect(formatCount(12_345, "en")).toBe("12,345");
    expect(formatCount(0, "ja")).toBe("0");
  });
});

describe("formatRating", () => {
  it("keeps the one decimal of the scale", () => {
    expect(formatRating(4, "en")).toBe("4.0");
    expect(formatRating(3.25, "en")).toBe("3.3");
  });
});

describe("formatDays", () => {
  it("keeps one decimal of a fractional day", () => {
    expect(formatDays(2.25, "en")).toBe("2.3");
    expect(formatDays(1234.5, "en")).toBe("1,234.5");
  });
});
