import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_OFFSET,
  listLimitSearchParam,
  listOffsetSearchParam,
} from "./list-pagination";

describe("listLimitSearchParam", () => {
  it("keeps an allowed page size", () => {
    expect(listLimitSearchParam.parse("10")).toBe("10");
    expect(listLimitSearchParam.parse("50")).toBe("50");
  });

  it("falls back for a missing, invalid, or unbounded value", () => {
    const fallback = String(DEFAULT_LIST_PAGE_SIZE);
    expect(listLimitSearchParam.parse(null)).toBe(fallback);
    expect(listLimitSearchParam.parse("abc")).toBe(fallback);
    expect(listLimitSearchParam.parse("100000")).toBe(fallback);
  });
});

describe("listOffsetSearchParam", () => {
  it("keeps a non-negative offset", () => {
    expect(listOffsetSearchParam.parse("20")).toBe(20);
  });

  it("falls back for a missing or invalid value", () => {
    expect(listOffsetSearchParam.parse(null)).toBe(0);
    expect(listOffsetSearchParam.parse("abc")).toBe(0);
  });

  it("clamps an out-of-range value", () => {
    expect(listOffsetSearchParam.parse("-4")).toBe(0);
    expect(listOffsetSearchParam.parse(String(MAX_LIST_OFFSET + 1))).toBe(
      MAX_LIST_OFFSET
    );
  });
});
