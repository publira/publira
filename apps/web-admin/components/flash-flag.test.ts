import { describe, expect, it } from "vitest";

import { isFlashFlagSet } from "./flash-flag";

describe("isFlashFlagSet", () => {
  it("accepts the flash value the pages post", () => {
    expect(isFlashFlagSet("1")).toBe(true);
  });

  it("ignores a missing, unknown, or over-long value", () => {
    expect(isFlashFlagSet(null)).toBe(false);
    expect(isFlashFlagSet("true")).toBe(false);
    expect(isFlashFlagSet("yes")).toBe(false);
    expect(isFlashFlagSet("1".repeat(300))).toBe(false);
  });

  it("treats conflicting repeated values as unset", () => {
    expect(isFlashFlagSet(["1", "0"])).toBe(false);
  });
});
