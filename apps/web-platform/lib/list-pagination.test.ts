import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIST_PAGE_SIZE,
  listLimitSearchParam,
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
